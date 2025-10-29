export type ClassValue = string | false | null | undefined | Record<string, boolean>;

export function cn(...values: ClassValue[]): string {
  const classes: string[] = [];
  for (const value of values) {
    if (!value) continue;
    if (typeof value === "string") {
      classes.push(value);
      continue;
    }
    for (const [key, enabled] of Object.entries(value)) {
      if (enabled) {
        classes.push(key);
      }
    }
  }
  return classes.join(" ");
}
