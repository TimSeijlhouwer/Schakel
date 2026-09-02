import React, { useState, useEffect, useRef } from "react";
import { createGame, joinGame } from "../lib/api";

// Drijvende woordtegels op de achtergrond
const FLOATING_WORDS = [
  "sneeuw","storm","zon","maan","ster","zee","berg","vuur","ijs","wind",
  "goud","zilver","draak","ridder","schat","kompas","raket","planeet","bliksem","kroon",
  "zwaard","vlinder","kasteel","dolfijn","komeet","parel",
];

function FloatingTiles() {
  const tiles = useRef(
    FLOATING_WORDS.map((w, i) => ({
      word: w,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: 0.7 + Math.random() * 0.5,
      delay: i * 0.4,
      dur: 18 + Math.random() * 14,
    }))
  );
  return (
    <div className="floaters" aria-hidden="true">
      {tiles.current.map((t, i) => (
        <span
          key={i}
          className="floater"
          style={{
            left: `${t.x}%`,
            top: `${t.y}%`,
            fontSize: `${t.size}rem`,
            animationDelay: `${t.delay}s`,
            animationDuration: `${t.dur}s`,
          }}
        >
          {t.word}
        </span>
      ))}
    </div>
  );
}

export default function Home({ user, onEnter }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setMounted(true));
  }, []);

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
    } finally { setBusy(false); }
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
    } finally { setBusy(false); }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && code.trim().length >= 3) handleJoin();
  };

  return (
    <div className="home">
      <FloatingTiles />

      <div className={"hero" + (mounted ? " in" : "")}>
        <div className="hero-chain">⛓</div>
        <h1 className="hero-title">SCHAKEL</h1>
        <p className="hero-sub">
          Verbind woorden. Raad wat je vrienden denken.<br />
          Speel samen op je eigen telefoon.
        </p>
      </div>

      <div className={"homecard" + (mounted ? " in" : "")}>
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

        <button className="bigbtn glow" disabled={busy} onClick={handleCreate}>
          <span className="btn-icon">✦</span> Nieuw spel
        </button>

        <div className="or"><span>of doe mee</span></div>

        <div className="joinrow">
          <input
            className="textinput code"
            placeholder="CODE"
            value={code}
            maxLength={6}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={handleKeyDown}
          />
          <button className="bigbtn slim" disabled={busy} onClick={handleJoin}>
            Meedoen
          </button>
        </div>

        {error && <p className="errbox">{error}</p>}

        <div className="home-features">
          <div className="feat"><span className="feat-icon">🎯</span><span>Raad elkaars woorden</span></div>
          <div className="feat"><span className="feat-icon">💀</span><span>Pas op voor het zwarte woord</span></div>
          <div className="feat"><span className="feat-icon">⚡</span><span>Multiplier bij meerdere goede</span></div>
        </div>
      </div>
    </div>
  );
}
