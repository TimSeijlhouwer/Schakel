import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import {
  fetchSnapshot, fetchTurnGuesses,
  submitClue, submitGuess, resolveTurn, nextTurn, endGameRpc,
} from "../lib/gameApi";

export default function Game({ user, game, onLeave }) {
  const gameId = game.id;
  const [snap, setSnap] = useState(null);       // {game, players, words, mySecrets}
  const [guesses, setGuesses] = useState([]);   // gokken van de huidige beurt
  const [selection, setSelection] = useState([]); // lokale keuze tijdens raden
  const [submitted, setSubmitted] = useState(false);
  const [clueWord, setClueWord] = useState("");
  const [clueNum, setClueNum] = useState(2);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState(null);
  const resolveGuard = useRef(false);

  // --- laden + realtime ---
  const load = async () => {
    try {
      const s = await fetchSnapshot(gameId);
      setSnap(s);
      if (s.game?.turn_number) {
        setGuesses(await fetchTurnGuesses(gameId, s.game.turn_number));
      }
    } catch (e) { setError(e.message); }
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`game:${gameId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "games", filter: `id=eq.${gameId}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: `game_id=eq.${gameId}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "guesses", filter: `game_id=eq.${gameId}` }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [gameId]);

  // klok voor de timer
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  // reset lokale keuze bij een nieuwe beurt/fase
  const g = snap?.game;
  useEffect(() => {
    setSelection([]); setSubmitted(false);
    setClueWord(""); setClueNum(2);
  }, [g?.turn_number, g?.phase]);

  const players = snap?.players || [];
  const me = players.find((p) => p.user_id === user.id);
  const amHost = g?.host_id === user.id;
  const amHint = g?.hintgever === me?.id;
  const hintPlayer = players.find((p) => p.id === g?.hintgever);

  const mySecret = new Set((snap?.mySecrets || []).map((s) => s.word_idx));
  const myFound = new Set((snap?.mySecrets || []).filter((s) => s.found).map((s) => s.word_idx));
  const myFoundCount = myFound.size;

  const secondsLeft = useMemo(() => {
    if (g?.phase !== "guess" || !g?.phase_ends_at) return null;
    return Math.max(0, Math.ceil((new Date(g.phase_ends_at).getTime() - now) / 1000));
  }, [g?.phase, g?.phase_ends_at, now]);

  // host onthult automatisch als de tijd om is
  useEffect(() => {
    if (g?.phase === "guess" && secondsLeft === 0 && amHost && !resolveGuard.current) {
      resolveGuard.current = true;
      resolveTurn(gameId).catch((e) => setError(e.message)).finally(() => {
        setTimeout(() => (resolveGuard.current = false), 2000);
      });
    }
  }, [secondsLeft, g?.phase, amHost, gameId]);

  if (!g) return <main className="panel"><p className="dim">Laden…</p></main>;

  // ---- einde ----
  if (g.status === "ended") {
    return <GameOver players={players} onLeave={onLeave} />;
  }

  // ---- board tegel-toestand ----
  const correctThisTurn = new Set(guesses.filter((x) => x.correct).map((x) => x.word_idx));
  const guessedThisTurn = new Set(guesses.map((x) => x.word_idx));
  const myGuessSet = new Set(guesses.filter((x) => x.rater_id === me?.id).map((x) => x.word_idx));
  const blackIdx = g.black_word_idx;

  const tileState = (idx) => {
    if (g.phase === "clue" && amHint) {
      if (myFound.has(idx)) return "minedone";
      if (mySecret.has(idx)) return "mine";
    }
    if (g.phase === "reveal" && idx === blackIdx && guessedThisTurn.has(idx)) return "black";
    if (g.phase === "reveal" && correctThisTurn.has(idx)) return "fresh";
    if (g.phase === "guess" && selection.includes(idx)) return "sel";
    return "";
  };

  const toggle = (idx) => {
    if (g.phase !== "guess" || amHint || submitted) return;
    setSelection((sel) => {
      if (sel.includes(idx)) return sel.filter((x) => x !== idx);
      if (sel.length >= g.clue_number) return sel;
      return [...sel, idx];
    });
  };

  const doClue = async () => {
    setError(null);
    try { await submitClue(gameId, clueWord, clueNum); }
    catch (e) { setError(e.message); }
  };
  const doGuess = async () => {
    setError(null);
    if (submitted) { setSubmitted(false); return; } // terug naar wijzigen
    try { await submitGuess(gameId, selection); setSubmitted(true); }
    catch (e) { setError(e.message); }
  };

  return (
    <main className="panel gamepanel">
      {/* kopbalk met beurt-info */}
      <div className="ghead">
        <div className="gturn">
          <span className="pill" style={{ background: hintPlayer?.color }}>{hintPlayer?.name}</span>
          <span className="gturntxt">
            {g.phase === "clue" && (amHint ? "jouw beurt — geef een hint" : "denkt na over een hint…")}
            {g.phase === "guess" && "aan het raden"}
            {g.phase === "reveal" && "ronde afgelopen"}
          </span>
        </div>
        <div className="gmeta">
          <span className="myprog">jij: {myFoundCount}/{mySecret.size}</span>
          {secondsLeft != null && (
            <span className={"timer" + (secondsLeft <= 10 ? " low" : "")}>{secondsLeft}s</span>
          )}
        </div>
      </div>

      {g.phase !== "clue" || amHint ? (
        <>
          {(g.phase === "guess" || g.phase === "reveal") && (
            <div className="cluebanner">
              <span>hint</span>
              <b className="cluebig">"{g.clue_word}"</b>
              <span className="cluenum">{g.clue_number}</span>
            </div>
          )}

          <Field words={snap.words} tileState={tileState} onTile={toggle} />
        </>
      ) : (
        <div className="waitcard">
          <div className="spinner" />
          <p>{hintPlayer?.name} denkt na over een hint…</p>
        </div>
      )}

      {/* onderbalk per fase */}
      {g.phase === "clue" && amHint && (
        <div className="cluebar">
          <input className="clueinput" placeholder="linkwoord…" value={clueWord}
            onChange={(e) => setClueWord(e.target.value)} />
          <div className="numpick">
            <span>getal</span>
            <button onClick={() => setClueNum((n) => Math.max(1, n - 1))}>–</button>
            <b>{clueNum}</b>
            <button onClick={() => setClueNum((n) => Math.min(mySecret.size - myFoundCount || 1, n + 1))}>+</button>
          </div>
          <button className="bigbtn slim" disabled={!clueWord.trim()} onClick={doClue}>Geef hint</button>
        </div>
      )}

      {g.phase === "guess" && !amHint && (
        <div className="guessbar">
          <span className="counter">{selection.length} / {g.clue_number} gekozen{submitted ? " · ingediend" : ""}</span>
          <button className="bigbtn slim" onClick={doGuess}>{submitted ? "Wijzig keuze" : "Bevestig"}</button>
        </div>
      )}

      {g.phase === "guess" && amHint && (
        <p className="dim center">De anderen raden jouw woorden…</p>
      )}

      {g.phase === "reveal" && (
        <RevealPanel players={players} guesses={guesses} hintPlayer={hintPlayer}
          blackIdx={blackIdx} amHost={amHost}
          onNext={() => nextTurn(gameId).catch((e) => setError(e.message))} />
      )}

      {/* host-knoppen */}
      <div className="hostrow">
        {amHost && g.phase === "guess" && (
          <button className="ghostbtn" onClick={() => resolveTurn(gameId)}>Onthul nu</button>
        )}
        {amHost && (
          <button className="ghostbtn" onClick={() => endGameRpc(gameId)}>Spel beëindigen</button>
        )}
      </div>

      <StandingsStrip players={players} />
      {error && <p className="errbox">{error}</p>}
    </main>
  );
}

function Field({ words, tileState, onTile }) {
  return (
    <div className="field">
      {words.map((w) => {
        const st = tileState(w.idx);
        return (
          <button key={w.idx} className={"tile " + st} onClick={() => onTile(w.idx)}>
            <span className="tileword">{w.text}</span>
            {st === "sel" && <span className="selmark">✓</span>}
            {st === "minedone" && <span className="donemark">✓</span>}
            {st === "black" && <span className="blackmark">💀</span>}
          </button>
        );
      })}
    </div>
  );
}

function RevealPanel({ players, guesses, hintPlayer, blackIdx, amHost, onNext }) {
  const byRater = {};
  guesses.forEach((x) => {
    byRater[x.rater_id] = byRater[x.rater_id] || { c: 0, w: 0, hitBlack: false };
    if (x.correct) byRater[x.rater_id].c++;
    else byRater[x.rater_id].w++;
    if (x.word_idx === blackIdx) byRater[x.rater_id].hitBlack = true;
  });
  const pts = (c) => (c > 0 ? 2 * c - 1 : 0);
  const rows = Object.entries(byRater).map(([id, v]) => ({
    player: players.find((p) => p.id === id), ...v, pts: pts(v.c),
    net: pts(v.c) - (v.hitBlack ? 3 : 0),
  }));
  const blackHits = rows.filter((r) => r.hitBlack).length;
  const hintGain = rows.reduce((s, r) => s + pts(r.c), 0) - (blackHits * 3);

  return (
    <div className="reveal">
      <p className="revtop">
        <span className="pill sm" style={{ background: hintPlayer?.color }}>{hintPlayer?.name}</span>
        &nbsp;verdiende <b style={{ color: hintGain >= 0 ? "#35D6C4" : "#FF5C7A" }}>{hintGain}</b> punten deze ronde
      </p>
      <div className="scorelist">
        {rows.map((r) => (
          <div className={"scorerow" + (r.hitBlack ? " blackhit" : "")} key={r.player?.id}>
            <span className="pill sm" style={{ background: r.player?.color }}>{r.player?.name}</span>
            <span className="scoretxt">
              {r.c} goed{r.w ? `, ${r.w} mis` : ""}
              {r.hitBlack && " · 💀 zwart woord!"}
            </span>
            <span className={"scorepts" + (r.net < 0 ? " neg" : "")}>{r.net >= 0 ? "+" : ""}{r.net}</span>
          </div>
        ))}
      </div>
      {amHost ? (
        <button className="bigbtn" onClick={onNext}>Volgende beurt</button>
      ) : (
        <p className="dim center">Wachten tot de host doorgaat…</p>
      )}
    </div>
  );
}

function GameOver({ players, onLeave }) {
  const firstCleared = players
    .filter((p) => p.cleared_at)
    .sort((a, b) => new Date(a.cleared_at) - new Date(b.cleared_at))[0];
  const maxG = Math.max(...players.map((p) => p.guesses_correct), 0);
  const standings = players
    .map((p) => {
      let bonus = 0; const tags = [];
      if (firstCleared && p.id === firstCleared.id) { bonus += 5; tags.push("Eerste klaar +5"); }
      if (maxG > 0 && p.guesses_correct === maxG) { bonus += 5; tags.push("Meeste geraden +5"); }
      return { ...p, bonus, total: p.score + bonus, tags };
    })
    .sort((a, b) => b.total - a.total);

  return (
    <main className="panel">
      <h2 className="gotitle">Einduitslag</h2>
      <div className="podium">
        {standings.map((p, rank) => (
          <div className={"result r" + rank} key={p.id}>
            <span className="rank">{rank + 1}</span>
            <span className="pill" style={{ background: p.color }}>{p.name}</span>
            <span className="resmid">{p.tags.map((t) => <em key={t} className="bonustag">{t}</em>)}</span>
            <span className="restot">{p.total}</span>
          </div>
        ))}
      </div>
      <button className="bigbtn" onClick={onLeave}>Terug naar start</button>
    </main>
  );
}

function StandingsStrip({ players }) {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  return (
    <div className="strip">
      {sorted.map((p) => (
        <div className="stripitem" key={p.id}>
          <span className="dot" style={{ background: p.color }} />
          <span className="stripname">{p.name}</span>
          <span className="stripscore">{p.score}</span>
        </div>
      ))}
    </div>
  );
}
