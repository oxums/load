let logs: { message: string; timestamp: string; level: string }[] = [];
let log_listeners: Function[] = [];

export function addLogListener(listener: Function) {
  log_listeners.push(listener);
}

export function removeLogListener(listener: Function) {
  log_listeners = log_listeners.filter((l) => l !== listener);
}

export function log(message: string) {
  const timestamp = new Date().toISOString();
  const log_entry = {
    message,
    timestamp,
    level: "info",
  };
  logs.push(log_entry);
  log_listeners.forEach((listener) => listener(log_entry));
}

export function getLogs() {
  return logs;
}

export function clearLogs() {
  logs = [];
  log_listeners.forEach((listener) =>
    listener({
      message: "Logs cleared",
      timestamp: new Date().toISOString(),
      level: "clear",
    }),
  );
}

export function logError(message: string) {
  const timestamp = new Date().toISOString();
  const log_entry = {
    message,
    timestamp,
    level: "error",
  };
  logs.push(log_entry);
  log_listeners.forEach((listener) => listener(log_entry));
}

export function logWarning(message: string) {
  const timestamp = new Date().toISOString();
  const log_entry = {
    message,
    timestamp,
    level: "warning",
  };
  logs.push(log_entry);
  log_listeners.forEach((listener) => listener(log_entry));
}
