import { closeApp, minimizeApp } from "./window";

export function WindowButtons() {
  return (
    <div className="window-buttons">
      <button
        type="button"
        className="window-button"
        title="Minimize"
        onClick={() => void minimizeApp()}
      >
        _
      </button>
      <button
        type="button"
        className="window-button window-button-close"
        title="Close"
        onClick={() => void closeApp()}
      >
        ×
      </button>
    </div>
  );
}
