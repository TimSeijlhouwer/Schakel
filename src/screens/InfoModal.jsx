import React from "react";

export default function InfoModal({ onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <h2 className="modal-title">Hoe werkt Schakel?</h2>

        <div className="rule">
          <span className="rule-icon">🎲</span>
          <div>
            <h3>Het bord</h3>
            <p>Iedereen ziet hetzelfde woordveld. Jij hebt een paar geheime woorden
            daarin verstopt — alleen jij ziet welke. Ze kunnen ook bij andere spelers horen.</p>
          </div>
        </div>

        <div className="rule">
          <span className="rule-icon">💡</span>
          <div>
            <h3>Jouw beurt</h3>
            <p>Bedenk één linkwoord dat een paar van jouw woorden verbindt, en zeg
            hoeveel het er zijn. Bijvoorbeeld <em>"sneeuw · 3"</em> voor storm, bal en weer.</p>
          </div>
        </div>

        <div className="rule">
          <span className="rule-icon">🎯</span>
          <div>
            <h3>Raden</h3>
            <p>Is iemand anders aan de beurt? Klik dan woorden aan waarvan jij denkt
            dat ze van hem of haar zijn. Je mag er nooit meer aanklikken dan het genoemde getal.</p>
          </div>
        </div>

        <div className="rule">
          <span className="rule-icon">⚡</span>
          <div>
            <h3>Punten</h3>
            <p>Goed geraden levert punten op voor de rader én de hintgever.
            Meerdere goed in één ronde geeft een multiplier: 1 woord = 1 punt,
            2 = 3 punten, 3 = 5 punten. Fout raden kost niks.</p>
          </div>
        </div>

        <div className="rule danger">
          <span className="rule-icon">💀</span>
          <div>
            <h3>Het zwarte woord</h3>
            <p>Iedereen heeft één eigen zwart woord. Tijdens jouw beurt zie je het
            zwart op het bord — zorg dat je hint er niet naar wijst! Klikt een rader
            jouw zwarte woord aan, dan krijgen jullie <b>allebei −3 punten</b>.</p>
          </div>
        </div>

        <div className="rule">
          <span className="rule-icon">🏁</span>
          <div>
            <h3>Einde en bonussen</h3>
            <p>Het spel is klaar als alle woorden gevonden zijn. Aan het eind zijn er
            bonussen voor wie als eerste klaar was, wie het meeste raadde, en voor de
            beste combo's in één ronde.</p>
          </div>
        </div>

        <button className="bigbtn" onClick={onClose}>Begrepen</button>
      </div>
    </div>
  );
}
