import React, { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { fetchPlayers, startGame } from "../lib/api";
import { MAX_PLAYERS } from "../lib/constants";

export default function Lobby({ user, game, onLeave }) {
  const [players, setPlayers] = useState([]);
  const [status, setStatus] = useState(game.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const isHost = game.host_id === user.id;

  useEffect(() => {
    let active = true;
    const load = () => fetchPlayers(game.id).then((p) => active && setPlayers(p)).catch(() => {});
    load();

    // Realtime: elke wijziging aan spelers of aan het spel opnieuw ophalen.
    const channel = supabase
      .channel(`lobby:${game.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "players", filter: `game_id=eq.${game.id}` },
        load
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "games", filter: `id=eq.${game.id}` },
        (payload) => active && setStatus(payload.new.status)
      )
      .subscribe();

    return () => { active = false; supabase.removeChannel(channel); };
  }, [game.id]);

  const handleStart = async () => {
    setError(null);
    setBusy(true);
    try {
      await startGame(game.id);
    } catch (e) {
      setError(e.message || "Starten mislukt.");
    } finally {
      setBusy(false);
    }
  };

  if (status === "playing") {
    return (
      <main className="panel">
        <div className="placeholder">
          <h2>Het spel begint…</h2>
          <p className="dim">
            Dit is het lobby-skelet. De speelschermen (woordveld, hints, raden, punten)
            bouwen we in de volgende stap bovenop deze lobby.
          </p>
          <button className="bigbtn slim" onClick={onLeave}>Terug naar start</button>
        </div>
      </main>
    );
  }

  return (
    <main className="panel">
      <div className="codecard">
        <span className="codelabel">Spelcode — deel deze met je vrienden</span>
        <span className="codebig">{game.code}</span>
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

      {isHost ? (
        <button className="bigbtn" disabled={busy || players.length < 2} onClick={handleStart}>
          {players.length < 2 ? "Wacht op minstens 2 spelers" : "Start het spel"}
        </button>
      ) : (
        <p className="dim center">Wachten tot de host het spel start…</p>
      )}

      {error && <p className="errbox">{error}</p>}
    </main>
  );
}
