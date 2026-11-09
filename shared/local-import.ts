export interface LocalImportOptions {
  autoLayout: boolean;
  hover: boolean;
  highResolution: boolean;
  htmlNames: boolean;
  // Web fonts that Figma lacks are drawn as images so the text looks the same.
  rasterizeMissingFonts?: boolean;
  availableFonts?: string[];
  // Run page scripts once in an isolated sandbox before parsing.
  runScripts?: boolean;
  // Click through script-driven tabs and switchers, one layer per state.
  captureScriptStates?: boolean;
}
export const defaultLocalImportOptions: LocalImportOptions = {
  autoLayout: false, hover: false, highResolution: false, htmlNames: false,
};
