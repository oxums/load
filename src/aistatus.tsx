import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LoadingSpinner } from "./Spinner";
import { getSettings } from "./settings";

export function AIStatus({
  setAIModal,
}: {
  setAIModal: (open: boolean) => void;
}) {
  const [isOllamaAvailable, setOllamaAvailable] = useState<boolean | null>(
    null,
  );
  const [isModelDownloaded, setModelDownloaded] = useState<boolean | null>(
    null,
  );
  const [isDownloading, setIsDownloading] = useState<boolean>(false);

  useEffect(() => {
    invoke<boolean>("ollama_available").then((available) => {
      setOllamaAvailable(available);
    });

    getSettings().then((settings) => {
      invoke<boolean>("ollama_model_is_downloaded", {
        model: settings.ai,
      }).then((downloaded) => {
        setModelDownloaded(downloaded);
      });
    });
  });

  return (
    <div className="absolute top-1/2 left-1/2 -translate-1/2">
      <div className="bg-(--background-secondary-color) text-text px-4 py-2 border border-(--token-functions) rounded-md shadow-md min-w-xs min-h-xs">
        <div className="absolute top-1 right-2">
          <button
            className="text-text focus:outline-none"
            onClick={() => setAIModal(false)}
          >
            &#10005;
          </button>
        </div>

        <div className="absolute top-1 left-2">AI Status</div>

        <div className="mt-6"></div>

        {isOllamaAvailable === null || isDownloading ? (
          <div className="flex justify-center items-center my-4">
            <LoadingSpinner />
          </div>
        ) : isOllamaAvailable ? (
          <div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-3">
                <span className="font-semibold">Ollama:</span>

                <span className="flex items-center gap-1 text-green-600">
                  <span>Available</span>
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-semibold">Model:</span>
                {isModelDownloaded === null ? (
                  <span className="flex items-center gap-1 text-gray-400">
                    <LoadingSpinner size={16} />
                    <span>Checking...</span>
                  </span>
                ) : isModelDownloaded ? (
                  <span className="flex items-center gap-1 text-green-600">
                    <span>Downloaded</span>
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-yellow-500">
                    <span>Not Downloaded</span>
                    <button onClick={() => {
                      setIsDownloading(true);
                      getSettings().then((settings) => {
                        invoke<void>("ollama_pull_model", {
                          model: settings.ai,
                        }).then(() => {
                          setIsDownloading(false);
                          setModelDownloaded(true);
                        });
                      });
                    }} className="px-2 py-1 mx-1 rounded bg-(--background-color) text-xs border-(--token-functions) border">
                      Download
                    </button>
                  </span>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div>
            <p className="text-xl">Ollama is not installed</p>
            <p>Our AI autocomplete requires Ollama to be installed locally</p>
            <div>
              <a
                href="https://ollama.com/download"
                target="_blank"
                rel="noopener noreferrer"
                className="text-(--token-functions) underline"
              >
                Download Ollama
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
