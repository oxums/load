import { getCurrentWindow } from "@tauri-apps/api/window";
import { Maximize, X } from "lucide-react";

function App() {
  const appWindow = getCurrentWindow();

  return (
    <div className="grid grid-rows-24 full">
      <div
        className="row-span-1 bg-(--background-secondary-color) flex justify-between items-center"
        onMouseDown={(e) => {
          if (e.buttons === 1) {
            e.detail === 2
              ? appWindow.toggleMaximize()
              : appWindow.startDragging();
          }
        }}
      >
        <div className="flex items-center gap-2"></div>
        <div className="flex items-center gap-2">
          
        </div>
      </div>
      <div className="row-span-23"></div>
    </div>
  );
}

export default App;
