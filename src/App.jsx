import React, { useEffect, useState } from "react";
import { ensureSession } from "./supabaseClient";
import Home from "./screens/Home";
import Lobby from "./screens/Lobby";

export default function App() {
  const [user, setUser] = useState(null);
  const [error, setError] = useState(null);
  const [game, setGame] = useState(null); // huidig spel waar je in zit (of null = home)

  useEffect(() => {
    ensureSession()
      .then(setUser)
      .catch((e) => setError(e.message || "Kon geen sessie starten."));
  }, []);

  return (
    <div className="root">
      <header className="topbar">
        <div className="brand"><span className="chain">⛓</span> SCHAKEL</div>
        {game && (
          <button className="ghostbtn" onClick={() => setGame(null)}>Verlaat lobby</button>
        )}
      </header>

      {error && <div className="panel"><p className="errbox">{error}</p></div>}

      {!user && !error && (
        <div className="panel"><p className="dim">Verbinden…</p></div>
      )}

      {user && !game && (
        <Home user={user} onEnter={setGame} />
      )}

      {user && game && (
        <Lobby user={user} game={game} onLeave={() => setGame(null)} />
      )}
    </div>
  );
}
