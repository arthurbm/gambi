import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const STARTER_INDEX = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Gambi city tile</title>
    <style>
      :root { --sky: #dff4ff; --ground: #d7c7a1; --accent: #ff6b35; }
      * { box-sizing: border-box; }
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: var(--sky); }
      canvas { display: block; }
    </style>
  </head>
  <body>
    <script type="module">
      import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue("--sky"));

      // Keep this shared isometric camera so neighboring tiles line up in the city mosaic.
      const camera = new THREE.OrthographicCamera(-6, 6, 6, -6, 0.1, 100);
      camera.position.set(8, 8, 8);
      camera.lookAt(0, 0, 0);

      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.setSize(innerWidth, innerHeight);
      document.body.append(renderer.domElement);

      scene.add(new THREE.HemisphereLight(0xffffff, 0x4c5266, 2));
      const sun = new THREE.DirectionalLight(0xffffff, 3);
      sun.position.set(4, 8, 6);
      scene.add(sun);

      // The fixed 10 x 10 lot is the boundary shared by every squad.
      const lot = new THREE.Mesh(
        new THREE.BoxGeometry(10, 0.25, 10),
        new THREE.MeshStandardMaterial({ color: getComputedStyle(document.documentElement).getPropertyValue("--ground") })
      );
      lot.position.y = -0.125;
      scene.add(lot);

      const landmark = new THREE.Mesh(
        new THREE.BoxGeometry(2.5, 3, 2.5),
        new THREE.MeshStandardMaterial({ color: getComputedStyle(document.documentElement).getPropertyValue("--accent") })
      );
      landmark.position.y = 1.5;
      scene.add(landmark);

      addEventListener("resize", () => renderer.setSize(innerWidth, innerHeight));
      renderer.setAnimationLoop(() => renderer.render(scene, camera));
    </script>
  </body>
</html>
`;

const STARTER_README = `# Neighborhood sign

Replace this text with:

- the squad name;
- the harness/model used;
- one sentence explaining what this neighborhood does.

Open \`index.html\` locally to preview the tile. Keep the fixed camera, lighting,
and 10 x 10 lot boundary so the tile fits the shared city.
`;

const STARTER_MANIFEST = `{
  "name": "New neighborhood",
  "description": "Describe what this neighborhood does.",
  "station": null,
  "palette": {
    "sky": "#dff4ff",
    "ground": "#d7c7a1",
    "accent": "#ff6b35"
  }
}
`;

export interface HarnessWorkspaceMetadata {
  harness: string;
  model: string;
  participantId: string;
  roomCode: string;
}

export interface CreateHarnessWorkspaceOptions
  extends HarnessWorkspaceMetadata {
  gambiHome?: string;
}

async function writeStarterFileIfMissing(
  path: string,
  content: string
): Promise<void> {
  if (await Bun.file(path).exists()) {
    return;
  }
  await Bun.write(path, content);
}

function encodeWorkspaceSegment(value: string): string {
  const encoded = encodeURIComponent(value);
  if (encoded === ".") {
    return "%2E";
  }
  if (encoded === "..") {
    return "%2E%2E";
  }
  return encoded;
}

export async function createHarnessWorkspace(
  options: CreateHarnessWorkspaceOptions
): Promise<string> {
  const gambiHome = options.gambiHome ?? join(homedir(), ".gambi");
  const workspacePath = join(
    gambiHome,
    "workspaces",
    encodeWorkspaceSegment(options.roomCode),
    encodeWorkspaceSegment(options.participantId)
  );
  await mkdir(workspacePath, { recursive: true });

  await Promise.all([
    writeStarterFileIfMissing(join(workspacePath, "index.html"), STARTER_INDEX),
    writeStarterFileIfMissing(join(workspacePath, "README.md"), STARTER_README),
    writeStarterFileIfMissing(
      join(workspacePath, "manifest.json"),
      STARTER_MANIFEST
    ),
  ]);

  await Bun.write(
    join(workspacePath, ".gambi.json"),
    `${JSON.stringify(
      {
        roomCode: options.roomCode,
        participantId: options.participantId,
        harness: options.harness,
        model: options.model,
      },
      null,
      2
    )}\n`
  );

  return workspacePath;
}
