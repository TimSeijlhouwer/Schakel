import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import {
  fetchSnapshot, fetchTurnGuesses,
  submitClue, submitGuess, resolveTurn, nextTurn, endGameRpc,
} from "../lib/gameApi";

export default function Game({ user, game, onLeave }) {
  const gameId = game.id;
  const [snap, setSnap] = useState(null);
  const [guesses, setGuesses] = useState([]);
  const [selection, setSelection] = useState([]);
  const [clueWord, setClueWord] = useState("");
  const [clueNum, setClueNum] = useState(2);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState(null);
  const resolveGuard = useRef(false);
  const saveTimer = useRef(null);

  const load = async () => {
    try {
      const s = await fetchSnapshot(gameId);
      setSnap(s);
      if (s.game?.turn_number) setGuesses(await fetchTurnGuesses(gameId, s.game.turn_number));
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

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const g = snap?.game;
  useEffect(() => {
    setSelection([]); setClueWord(""); setClueNum(2);
  }, [g?.turn_number, g?.phase]);

  const players = snap?.players || [];
  const me = players.find((p) => p.user_id === user.id);
  const amHost = g?.host_id === user.id;
  const amHint = g?.hintgever === me?.id;
  const hintPlayer = players.find((p) => p.id === g?.hintgever);

  // eigen geheime woorden + eigen zwart woord
  const secrets = snap?.mySecrets || [];
  const mySecret = new Set(secrets.filter((s) => !s.is_black).map((s) => s.word_idx));
  const myFound = new Set(secrets.filter((s) => !s.is_black && s.found).map((s) => s.word_idx));
  const myBlack = secrets.find((s) => s.is_black)?.word_idx;
  const myLeft = mySecret.size - myFound.size;

  // woorden die bij de huidige hintgever al gevonden zijn → voor iedereen doorgestreept
  const crossed = new Set(g?.hint_found_idxs || []);

  const secondsLeft = useMemo(() => {
    if (g?.phase !== "guess" || !g?.phase_ends_at) return null;
    return Math.max(0, Math.ceil((new Date(g.phase_ends_at).getTime() - now) / 1000));
  }, [g?.phase, g?.phase_ends_at, now]);

  useEffect(() => {
    if (g?.phase === "guess" && secondsLeft === 0 && amHost && !resolveGuard.current) {
      resolveGuard.current = true;
      resolveTurn(gameId).catch((e) => setError(e.message))
        .finally(() => setTimeout(() => (resolveGuard.current = false), 2000));
    }
  }, [secondsLeft, g?.phase, amHost, gameId]);

  if (!g) return <main className="panel"><p className="dim center">Laden…</p></main>;
  if (g.status === "ended") return <GameOver players={players} onLeave={onLeave} />;

  const correctThisTurn = new Set(guesses.filter((x) => x.correct).map((x) => x.word_idx));

  const tileState = (idx) => {
    // doorgestreept: al gevonden bij de speler die nu aan de beurt is
    if (crossed.has(idx)) return "crossed";
    // eigen beurt: toon je eigen woorden + je eigen zwarte woord
    if (g.phase === "clue" && amHint) {
      if (idx === myBlack) return "myblack";
      if (mySecret.has(idx)) return "mine";
    }
    if (g.phase === "guess" && amHint && idx === myBlack) return "myblack";
    if (g.phase === "reveal" && correctThisTurn.has(idx)) return "fresh";
    if (g.phase === "guess" && selection.includes(idx)) return "sel";
    return "";
  };

  // keuze meteen opslaan, zodat niet-bevestigde keuzes ook meetellen
  const saveSelection = (sel) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      submitGuess(gameId, sel).catch(() => {});
    }, 400);
  };

  const toggle = (idx) => {
    if (g.phase !== "guess" || amHint || crossed.has(idx)) return;
    setSelection((sel) => {
      let next;
      if (sel.includes(idx)) next = sel.filter((x) => x !== idx);
      else if (sel.length >= g.clue_number) return sel;
      else next = [...sel, idx];
      saveSelection(next);
      return next;
    });
  };

  const doClue = async () => {
    setError(null);
    try { await submitClue(gameId, clueWord, clueNum); }
    catch (e) { setError(e.message); }
  };

  const maxClue = Math.max(1, myLeft);

  return (
    <main className="panel gamepanel">
      <div className="ghead">
        <div className="gturn">
          <span className="pill" style={{ background: hintPlayer?.color }}>{hintPlayer?.name}</span>
          <span className="gturntxt">
            {g.phase === "clue" && (amHint ? "jouw beurt — geef een hint" : "denkt na…")}
            {g.phase === "guess" && "aan het raden"}
            {g.phase === "reveal" && "ronde afgelopen"}
          </span>
        </div>
        <div className="gmeta">
          <span className="myprog">jij: nog {myLeft}</span>
          {secondsLeft != null && (
            <span className={"timer" + (secondsLeft <= 10 ? " low" : "")}>{secondsLeft}s</span>
          )}
        </div>
      </div>

      {/* waarschuwing voor je eigen zwarte woord tijdens jouw beurt */}
      {amHint && (g.phase === "clue" || g.phase === "guess") && myBlack != null && (
        <div className="blackwarn">
          💀 Jouw zwarte woord staat zwart op het bord. Zorg dat je hint er niet naar wijst —
          wordt het geraden, dan kost het jullie allebei 3 punten.
        </div>
      )}

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

      {g.phase === "clue" && amHint && (
        <div className="cluebar">
          <input className="clueinput" placeholder="linkwoord…" value={clueWord}
            onChange={(e) => setClueWord(e.target.value)} />
          <div className="numpick">
            <span>getal</span>
            <button onClick={() => setClueNum((n) => Math.max(1, n - 1))}>–</button>
            <b>{clueNum}</b>
            <button onClick={() => setClueNum((n) => Math.min(maxClue, n + 1))}>+</button>
          </div>
          <button className="bigbtn slim" disabled={!clueWord.trim()} onClick={doClue}>Geef hint</button>
        </div>
      )}

      {g.phase === "guess" && !amHint && (
        <div className="guessbar">
          <span className="counter">
            {selection.length} / {g.clue_number} gekozen
            <span className="autosave"> · wordt automatisch bewaard</span>
          </span>
        </div>
      )}

      {g.phase === "guess" && amHint && (
        <p className="dim center">De anderen raden jouw woorden…</p>
      )}

      {g.phase === "reveal" && (
        <RevealPanel players={players} guesses={guesses} hintPlayer={hintPlayer}
          amHost={amHost} onNext={() => nextTurn(gameId).catch((e) => setError(e.message))} />
      )}

      <div className="hostrow">
        {amHost && g.phase === "guess" && (
          <button className="ghostbtn" onClick={() => resolveTurn(gameId)}>Onthul nu</button>
        )}
        {amHost && <button className="ghostbtn" onClick={() => endGameRpc(gameId)}>Spel beëindigen</button>}
      </div>

      <StandingsStrip players={players} meId={me?.id} />
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
            {st === "myblack" && <span className="blackmark">💀</span>}
            {st === "crossed" && <span className="donemark">✓</span>}
          </button>
        );
      })}
    </div>
  );
}

function RevealPanel({ players, guesses, hintPlayer, amHost, onNext }) {
  const byRater = {};
  guesses.forEach((x) => {
    byRater[x.rater_id] = byRater[x.rater_id] || { c: 0, w: 0 };
    if (x.correct) byRater[x.rater_id].c++; else byRater[x.rater_id].w++;
  });
  const pts = (c) => (c > 0 ? 2 * c - 1 : 0);
  const rows = Object.entries(byRater).map(([id, v]) => ({
    player: players.find((p) => p.id === id), ...v, pts: pts(v.c),
  }));
  const hintGain = rows.reduce((s, r) => s + r.pts, 0);

  return (
    <div className="reveal">
      <p className="revtop">
        <span className="pill sm" style={{ background: hintPlayer?.color }}>{hintPlayer?.name}</span>
        &nbsp;kreeg <b style={{ color: hintGain >= 0 ? "#35D6C4" : "#FF5C7A" }}>{hintGain}</b> punten deze ronde
      </p>
      <div className="scorelist">
        {rows.map((r) => (
          <div className="scorerow" key={r.player?.id}>
            <span className="pill sm" style={{ background: r.player?.color }}>{r.player?.name}</span>
            <span className="scoretxt">{r.c} goed{r.w ? `, ${r.w} mis` : ""}</span>
            <span className={"scorepts" + (r.pts <= 0 ? " neg" : "")}>+{r.pts}</span>
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

/* ---------------- EINDSCHERM ---------------- */
function GameOver({ players, onLeave }) {
  // aflopende bonussen: 10, 8, 6, 4, 2, 0
  const ladder = (rank) => Math.max(0, 10 - rank * 2);

  // volgorde: wie was als eerste klaar
  const clearedRank = players
    .filter((p) => p.cleared_at)
    .sort((a, b) => new Date(a.cleared_at) - new Date(b.cleared_at))
    .map((p) => p.id);

  // volgorde: meeste geraden
  const guessRank = [...players]
    .filter((p) => p.guesses_correct > 0)
    .sort((a, b) => b.guesses_correct - a.guesses_correct)
    .map((p) => p.id);

  const bestHint = Math.max(...players.map((p) => p.best_combo_hint || 0), 0);
  const bestRate = Math.max(...players.map((p) => p.best_combo_rate || 0), 0);

  const standings = players.map((p) => {
    let bonus = 0; const tags = [];
    const ci = clearedRank.indexOf(p.id);
    if (ci >= 0 && ladder(ci) > 0) {
      bonus += ladder(ci);
      tags.push(`${ci === 0 ? "Eerste" : `${ci + 1}e`} klaar +${ladder(ci)}`);
    }
    const gi = guessRank.indexOf(p.id);
    if (gi >= 0 && ladder(gi) > 0) {
      bonus += ladder(gi);
      tags.push(`${gi === 0 ? "Meeste" : `${gi + 1}e meeste`} geraden +${ladder(gi)}`);
    }
    if (bestHint > 0 && p.best_combo_hint === bestHint) {
      bonus += bestHint;
      tags.push(`Beste hint (${bestHint} in 1 ronde) +${bestHint}`);
    }
    if (bestRate > 0 && p.best_combo_rate === bestRate) {
      bonus += bestRate;
      tags.push(`Beste raadronde (${bestRate}) +${bestRate}`);
    }
    return { ...p, bonus, total: p.score + bonus, tags };
  }).sort((a, b) => b.total - a.total);

  const winner = standings[0];
  const runnerUp = standings[1];
  const margin = runnerUp ? winner.total - runnerUp.total : 0;

  const summary = () => {
    if (!winner) return "";
    if (margin === 0) return `Kopje-kop! ${winner.name} en ${runnerUp.name} eindigen gelijk bovenaan.`;
    if (margin <= 3) return `Nek-aan-nek: ${winner.name} wint met maar ${margin} punt${margin === 1 ? "" : "en"} verschil.`;
    if (margin >= 15) return `${winner.name} liep helemaal weg met het spel — ${margin} punten voorsprong.`;
    return `${winner.name} wint met ${margin} punten voorsprong op ${runnerUp.name}.`;
  };

  const mostGuessed = players.reduce((a, b) => (b.guesses_correct > (a?.guesses_correct ?? -1) ? b : a), null);

  return (
    <main className="panel">
      <h2 className="gotitle">Einduitslag</h2>

      <div className="summarycard">
        <div className="crown">👑</div>
        <p className="sumwinner" style={{ color: winner?.color }}>{winner?.name}</p>
        <p className="sumtext">{summary()}</p>
        <div className="sumstats">
          {mostGuessed?.guesses_correct > 0 && (
            <span className="sumstat">🎯 {mostGuessed.name} raadde er {mostGuessed.guesses_correct}</span>
          )}
          {bestHint > 0 && <span className="sumstat">💡 beste hint: {bestHint} woorden in één ronde</span>}
          {bestRate > 0 && <span className="sumstat">⚡ beste raadronde: {bestRate} goed</span>}
        </div>
      </div>

      <div className="podium">
        {standings.map((p, rank) => (
          <div className={"result r" + rank} key={p.id}>
            <div className="resrow">
              <span className="rank">{rank + 1}</span>
              <span className="pill" style={{ background: p.color }}>{p.name}</span>
              <span className="restot">{p.total}</span>
            </div>
            {p.tags.length > 0 && (
              <div className="resmid">
                {p.tags.map((t) => <em key={t} className="bonustag">{t}</em>)}
              </div>
            )}
            <div className="resbase">basis {p.score}{p.bonus ? ` + bonus ${p.bonus}` : ""}</div>
          </div>
        ))}
      </div>

      <button className="bigbtn" onClick={onLeave}>Terug naar start</button>
    </main>
  );
}

function StandingsStrip({ players, meId }) {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  return (
    <div className="strip">
      {sorted.map((p) => {
        const done = (p.words_left ?? 1) === 0;
        return (
          <div className={"stripitem" + (p.id === meId ? " isme" : "") + (done ? " done" : "")} key={p.id}>
            <span className="dot" style={{ background: p.color }} />
            <span className="stripname">{p.name}</span>
            <span className="stripleft">{done ? "✓ klaar" : `nog ${p.words_left ?? "?"}`}</span>
            <span className="stripscore">{p.score}</span>
          </div>
        );
      })}
    </div>
  );
}
