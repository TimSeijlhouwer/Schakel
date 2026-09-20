import React, { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { fetchPlayers } from "../lib/api";
import { startGameRpc } from "../lib/gameApi";
import { MAX_PLAYERS } from "../lib/constants";
import Game from "./Game";

export default function Lobby({ user, game, onLeave }) {
  const [players, setPlayers] = useState([]);
  const [status, setStatus] = useState(game.status);
  const [wordsPer, setWordsPer] = useState(8);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const isHost = game.host_id === user.id;

  useEffect(() => {
    let active = true;
    const load = () => fetchPlayers(game.id).then((p) => active && setPlayers(p)).catch(() => {});
    load();
    const channel = supabase
      .channel(`lobby:${game.id}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "players", filter: `game_id=eq.${game.id}` }, load)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "games", filter: `id=eq.${game.id}` },
        (payload) => active && setStatus(payload.new.status))
      .subscribe();
    return () => { active = false; supabase.removeChannel(channel); };
  }, [game.id]);

  // Als het spel loopt (of net geëindigd is): toon het spelscherm.
  if (status === "playing" || status === "ended") {
    return <Game user={user} game={game} onLeave={onLeave} />;
  }

  const handleStart = async () => {
    setError(null); setBusy(true);
    try { await startGameRpc(game.id, wordsPer); }
    catch (e) { setError(e.message || "Starten mislukt."); setBusy(false); }
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(game.code);
      setCopied(true); setTimeout(() => setCopied(false), 1600);
    } catch {}
  };

  return (
    <main className="panel">
      <div className="codecard">
        <span className="codelabel">Spelcode — deel deze met je vrienden</span>
        <span className="codebig">{game.code}</span>
        <button className="copybtn" onClick={copyCode}>
          {copied ? "✓ gekopieerd" : "kopieer code"}
        </button>
      </div>

      <div className="setrow">
        <label>Spelers ({players.length}/{MAX_PLAYERS})</label>
        <div className="playerlist">
          {players.map((p) => (
            <div className="playeritem" key={p.id}>
              <span className="dot" style={{ background: p.color }} />
              <span className="pname">{p.name}</span>
              {p.user_id === game.host_id && <span className="hosttag">host</span>}
              {p.user_id === user.id && <span className="youtag">jij</span>}
            </div>
          ))}
        </div>
      </div>

      {/* korte uitleg vóór de start */}
      <div className="quickrules">
        <h3>In het kort</h3>
        <div className="qr"><span>1</span><p>Je krijgt geheime woorden in het gedeelde veld — alleen jij ziet welke.</p></div>
        <div className="qr"><span>2</span><p>Ben jij aan de beurt? Geef één linkwoord + een getal, bijvoorbeeld <em>"sneeuw · 3"</em>.</p></div>
        <div className="qr"><span>3</span><p>De rest klikt woorden aan. Goed geraden = punten voor de rader én voor jou.</p></div>
        <div className="qr danger"><span>💀</span><p>Iedereen heeft één zwart woord. Wordt die van jou geraden, dan kost het jullie allebei 3 punten.</p></div>
      </div>

      {isHost && (
        <div className="setrow">
          <label>Woorden per speler</label>
          <div className="chips">
            {[4, 6, 8].map((n) => (
              <button key={n} className={"chip" + (wordsPer === n ? " on" : "")} onClick={() => setWordsPer(n)}>{n}</button>
            ))}
            <span className="hint-inline">8 is het echte spel · 4–6 om snel te testen</span>
          </div>
        </div>
      )}

      {isHost ? (
        <button className="bigbtn glow" disabled={busy || players.length < 2} onClick={handleStart}>
          {players.length < 2 ? "Wacht op minstens 2 spelers" : (busy ? "Bezig…" : "Start het spel")}
        </button>
      ) : (
        <p className="dim center">Wachten tot de host het spel start…</p>
      )}

      {error && <p className="errbox">{error}</p>}
    </main>
  );
}
