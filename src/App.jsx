import React, { useEffect, useState } from "react";
import { supabase, ensureSession } from "./supabaseClient";
import Home from "./screens/Home";
import Lobby from "./screens/Lobby";
import InfoModal from "./screens/InfoModal";

const STORAGE_KEY = "schakel:game";

export default function App() {
  const [user, setUser] = useState(null);
  const [error, setError] = useState(null);
  const [game, setGame] = useState(null);
  const [restoring, setRestoring] = useState(true);
  const [showInfo, setShowInfo] = useState(false);

  // sessie + herstel het spel waar je in zat (na refresh)
  useEffect(() => {
    let active = true;
    ensureSession()
      .then(async (u) => {
        if (!active) return;
        setUser(u);
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          try {
            const { data } = await supabase
              .from("games").select("*").eq("id", saved).maybeSingle();
            // alleen terug als je er echt nog in zit en het niet afgelopen is
            if (data && data.status !== "ended") {
              const { data: mine } = await supabase
                .from("players").select("id")
                .eq("game_id", data.id).eq("user_id", u.id).maybeSingle();
              if (mine && active) setGame(data);
              else localStorage.removeItem(STORAGE_KEY);
            } else {
              localStorage.removeItem(STORAGE_KEY);
            }
          } catch { localStorage.removeItem(STORAGE_KEY); }
        }
      })
      .catch((e) => setError(e.message || "Kon geen sessie starten."))
      .finally(() => active && setRestoring(false));
    return () => { active = false; };
  }, []);

  const enterGame = (g) => {
    localStorage.setItem(STORAGE_KEY, g.id);
    setGame(g);
  };
  const leaveGame = () => {
    localStorage.removeItem(STORAGE_KEY);
    setGame(null);
  };

  return (
    <div className="root">
      <header className="topbar">
        <div className="brand"><span className="chain">⛓</span> SCHAKEL</div>
        <div className="topactions">
          <button className="iconbtn" title="Spelregels" onClick={() => setShowInfo(true)}>?</button>
          {game && <button className="ghostbtn" onClick={leaveGame}>Verlaten</button>}
        </div>
      </header>

      {showInfo && <InfoModal onClose={() => setShowInfo(false)} />}

      {error && <div className="panel"><p className="errbox">{error}</p></div>}

      {(!user || restoring) && !error && (
        <div className="panel"><p className="dim center">Verbinden…</p></div>
      )}

      {user && !restoring && !game && <Home user={user} onEnter={enterGame} />}
      {user && !restoring && game && (
        <Lobby user={user} game={game} onLeave={leaveGame} />
      )}
    </div>
  );
}
