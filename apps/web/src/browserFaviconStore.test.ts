import { vi } from "vite-plus/test";

vi.mock("~/state/entities", () => ({ useQuietThreadShell: () => null }));
vi.mock("~/state/session", () => ({ usePreparedConnection: () => ({ _tag: "None" }) }));
