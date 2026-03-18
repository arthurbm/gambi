export const LOGO = `
  ██████╗  █████╗ ███╗   ███╗██████╗ ██╗
 ██╔════╝ ██╔══██╗████╗ ████║██╔══██╗██║
 ██║  ███╗███████║██╔████╔██║██████╔╝██║
 ██║   ██║██╔══██║██║╚██╔╝██║██╔══██╗██║
 ╚██████╔╝██║  ██║██║ ╚═╝ ██║██████╔╝██║
  ╚═════╝ ╚═╝  ╚═╝╚═╝     ╚═╝╚═════╝ ╚═╝
               LLM CLUB
`;

export const LOGO_COMPACT = `
╔════════════════════════════╗
║      GAMBI LLM CLUB       ║
╚════════════════════════════╝
`;

export function printLogo(compact = false): void {
  console.log(compact ? LOGO_COMPACT : LOGO);
}
