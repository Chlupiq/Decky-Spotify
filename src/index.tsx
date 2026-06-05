import { definePlugin } from "@decky/api";
import { PanelSection, PanelSectionRow } from "@decky/ui";
import { App } from "./App";

export default definePlugin(() => {
  return {
    name: "Spotify Launcher Pro",
    titleView: <span style={{ color: "#1DB954" }}>🎵 Spotify</span>,
    content: (
      <PanelSection>
        <PanelSectionRow>
          <App />
        </PanelSectionRow>
      </PanelSection>
    ),
    icon: <span>🎵</span>,
    onDismount() {},
  };
});
