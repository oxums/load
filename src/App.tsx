import { getCurrentWindow } from "@tauri-apps/api/window";
import { X } from "lucide-react";
import { useState } from "react";

function FluentMinimize24Regular() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={24}
      height={24}
      viewBox="0 0 24 24"
    >
      <g fill="none">
        <path
          d="M3.755 12.5h16.492a.75.75 0 1 0 0-1.5H3.755a.75.75 0 0 0 0 1.5z"
          fill="currentColor"
        />
      </g>
    </svg>
  );
}

function QlementineIconsWindowsUnmaximize16() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={24}
      height={24}
      viewBox="0 0 16 16"
    >
      <path
        fill="currentColor"
        d="M9.8 4H5.27c.193-.334.479-.606.824-.782C6.522 3 7.082 3 8.204 3h1.6c1.12 0 1.68 0 2.11.218c.376.192.682.498.874.874c.218.428.218.988.218 2.11v1.6c0 1.12 0 1.68-.218 2.11a2 2 0 0 1-.782.824v-4.53c0-.577 0-.949-.024-1.23c-.022-.272-.06-.372-.085-.422a1 1 0 0 0-.437-.437c-.05-.025-.15-.063-.422-.085a17 17 0 0 0-1.23-.024z"
      />
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M3 8.2c0-1.12 0-1.68.218-2.11c.192-.376.498-.682.874-.874c.428-.218.988-.218 2.11-.218h1.6c1.12 0 1.68 0 2.11.218c.376.192.682.498.874.874c.218.428.218.988.218 2.11v1.6c0 1.12 0 1.68-.218 2.11a2 2 0 0 1-.874.874c-.428.218-.988.218-2.11.218h-1.6c-1.12 0-1.68 0-2.11-.218a2 2 0 0 1-.874-.874C3 11.482 3 10.922 3 9.8zM6.2 6h1.6c.577 0 .949 0 1.23.024c.272.022.372.06.422.085c.188.096.341.249.437.437c.025.05.063.15.085.422c.023.283.024.656.024 1.23v1.6c0 .577 0 .949-.024 1.23c-.022.272-.06.372-.085.422a1 1 0 0 1-.437.437c-.05.025-.15.063-.422.085c-.283.023-.656.024-1.23.024H6.2c-.577 0-.949 0-1.23-.024c-.272-.022-.372-.06-.422-.085a1 1 0 0 1-.437-.437c-.025-.05-.063-.15-.085-.422a17 17 0 0 1-.024-1.23v-1.6c0-.577 0-.949.024-1.23c.022-.272.06-.372.085-.422c.096-.188.249-.341.437-.437c.05-.025.15-.063.422-.085C5.253 6 5.626 6 6.2 6"
        clipRule="evenodd"
      />
    </svg>
  );
}

function WindowUpperMenuTab({
  name,
  options,
}: {
  name: string;
  options: {
    text: string;
    onClick: () => void;
    keybindSuggestion?: string;
  }[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="relative"
      tabIndex={0}
      onBlur={() => {
        setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      <button
        className="flex items-center gap-2 px-1.5 py-0.1 m-1 rounded-md hover:bg-(--background-color) select-none text-sm"
        onClick={() => setOpen((v) => !v)}
        onMouseDown={(e) => e.stopPropagation()}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <span className="select-none pointer-events-none text-[13px]">{name}</span>
      </button>

      {open && (
        <div className="absolute left-0 mt-0.5 ml-1 w-56 bg-(--background-secondary-color) border border-(--token-keywords) rounded-md p-1 shadow-lg z-50">
          <div className="flex flex-col">
            {options.map((opt, i) => (
              <button
                key={i}
                onMouseDown={() => {
                  try {
                    opt.onClick();
                  } finally {
                    setOpen(false);
                  }
                }}
                className="w-full flex items-center justify-between gap-2 px-2 py-0.5 rounded-sm hover:bg-(--background-color) text-[13px]"
              >
                <span className="truncate">{opt.text}</span>
                {opt.keybindSuggestion ? (
                  <span className="text-xs c text-(--token-comments) ml-2 select-none">
                    {opt.keybindSuggestion}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function App() {
  const appWindow = getCurrentWindow();

  const [windowTitle, setWindowTitle] = useState("");

  return (
    <div className="h-screen flex flex-col">
      <div
        className="shrink-0 bg-(--background-secondary-color) flex justify-between items-center min-h-6 max-h-8"
        onMouseDown={(e) => {
          if (e.buttons === 1) {
            e.detail === 2
              ? appWindow.toggleMaximize()
              : appWindow.startDragging();
          }
        }}
      >
        <div className="flex items-center gap-2">
          <WindowUpperMenuTab
            name="Load"
            options={[
              {
                text: "About",
                onClick: () => {
                  console.log("About clicked");
                },
              },
              {
                text: "Quit",
                onClick: () => {
                  appWindow.close();
                },
                keybindSuggestion: "Ctrl+Q",
              },
            ]}
          />
        </div>
        <div>
          <span className="select-none text-xs c text-(--token-comments)">
            {windowTitle}
          </span>
        </div>
        <div className="flex items-center flex-row-reverse gap-2 px-2">
          <button
            className="w-[11.5px] h-[11.5px] rounded-full bg-red-500 border border-black/10 hover:bg-red-400 transition-colors"
            aria-label="Close"
            onMouseDown={() => {
              appWindow.close();
            }}
            tabIndex={-1}
          />
          <button
            className="w-[11.5px] h-[11.5px] rounded-full bg-yellow-400 border border-black/10 hover:bg-yellow-300 transition-colors"
            aria-label="Minimize"
            onMouseDown={() => {
              appWindow.minimize();
            }}
            tabIndex={-1}
          />
          <button
            className="w-[11.5px] h-[11.5px] rounded-full bg-green-500 border border-black/10 hover:bg-green-400 transition-colors"
            aria-label="Maximize"
            onMouseDown={() => {
              appWindow.toggleMaximize();
            }}
            tabIndex={-1}
          />
        </div>
      </div>
      <div className="flex-1 flex w-full border-t border-(--token-functions)">
        <div className="w-xs max-w-[18rem] shrink-0 bg-(--background-secondary-color) flex flex-col justify-between border-r border-(--token-functions)">
          <div></div>
          <div className="p-1 border-t border-(--token-functions) flex items-center justify-between">
            <div className="flex items-center gap-0.5">
              <div className="nice">
                <span className="text-xs">Typescript</span>
              </div>
              <div className="nice">
                <span className="text-xs c text-blue-300">154:49</span>
              </div>
            </div>

            <div className="flex items-center gap-0.5">
              <div className="nice">
                <div className="c text-red-400">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="1em"
                    height="1em"
                    viewBox="0 0 24 24"
                    className="c"
                  >
                    <path
                      fill="currentColor"
                      d="M12 17q.425 0 .713-.288Q13 16.425 13 16t-.287-.713Q12.425 15 12 15t-.712.287Q11 15.575 11 16t.288.712Q11.575 17 12 17Zm0-4q.425 0 .713-.288Q13 12.425 13 12V8q0-.425-.287-.713Q12.425 7 12 7t-.712.287Q11 7.575 11 8v4q0 .425.288.712q.287.288.712.288Zm0 9q-2.075 0-3.9-.788q-1.825-.787-3.175-2.137q-1.35-1.35-2.137-3.175Q2 14.075 2 12t.788-3.9q.787-1.825 2.137-3.175q1.35-1.35 3.175-2.138Q9.925 2 12 2t3.9.787q1.825.788 3.175 2.138q1.35 1.35 2.137 3.175Q22 9.925 22 12t-.788 3.9q-.787 1.825-2.137 3.175q-1.35 1.35-3.175 2.137Q14.075 22 12 22Zm0-2q3.35 0 5.675-2.325Q20 15.35 20 12q0-3.35-2.325-5.675Q15.35 4 12 4Q8.65 4 6.325 6.325Q4 8.65 4 12q0 3.35 2.325 5.675Q8.65 20 12 20Zm0-8Z"
                    />
                  </svg>
                </div>
                <span className="text-xs">0 Errors</span>
              </div>
              <div className="nice">
                <div className="c text-yellow-400">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="1em"
                    height="1em"
                    viewBox="0 0 24 24"
                  >
                    <path
                      fill="currentColor"
                      d="M12 5.99L19.53 19H4.47zM2.74 18c-.77 1.33.19 3 1.73 3h15.06c1.54 0 2.5-1.67 1.73-3L13.73 4.99c-.77-1.33-2.69-1.33-3.46 0zM11 11v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1m0 5h2v2h-2z"
                    />
                  </svg>
                </div>
                <span className="text-xs">1 Warning</span>
              </div>
            </div>
          </div>
        </div>
        <div className="flex-1"></div>
      </div>
    </div>
  );
}

export default App;
