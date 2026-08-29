import React, { useState } from "react";
import { createGame, joinGame } from "../lib/api";

export default function Home({ user, onEnter }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const needName = () => {
    if (name.trim().length < 1) { setError("Vul eerst je naam in."); return true; }
    return false;
  };

  const handleCreate = async () => {
    setError(null);
    if (needName()) return;
    setBusy(true);
    try {
      const game = await createGame(user.id, name.trim());
      onEnter(game);
    } catch (e) {
      setError(e.message || "Aanmaken mislukt.");
    } finally {
      setBusy(false);
    }
  };

  const handleJoin = async () => {
    setError(null);
    if (needName()) return;
    if (code.trim().length < 3) { setError("Vul een geldige code in."); return; }
    setBusy(true);
    try {
      const game = await joinGame(user.id, name.trim(), code);
      onEnter(game);
    } catch (e) {
      setError(e.message || "Meedoen mislukt.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="panel">
      <p className="lede">
        Speel <em>Schakel</em> met vrienden op eigen telefoon. Maak een spel aan en deel
        de code, of doe mee met een code die je hebt gekregen.
      </p>

      <div className="setrow">
        <label>Jouw naam</label>
        <input
          className="textinput"
          placeholder="bv. Sam"
          value={name}
          maxLength={16}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <button className="bigbtn" disabled={busy} onClick={handleCreate}>
        Nieuw spel aanmaken
      </button>

      <div className="or"><span>of</span></div>

      <div className="joinrow">
        <input
          className="textinput code"
          placeholder="CODE"
          value={code}
          maxLength={6}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
        <button className="bigbtn slim" disabled={busy} onClick={handleJoin}>
          Meedoen
        </button>
      </div>

      {error && <p className="errbox">{error}</p>}
    </main>
  );
}
