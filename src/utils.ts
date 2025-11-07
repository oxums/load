export function setCSSvar(variable: string, value: string) {
  document.documentElement.style.setProperty(variable, value);
}

export function getCSSvar(variable: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(variable);
}

export function deepMerge(target: any, source: any): any {
  for (const key in source) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key])
    ) {
      target[key] = deepMerge({ ...target[key] }, source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}
