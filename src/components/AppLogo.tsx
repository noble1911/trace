import icon from "@/assets/icon.png";

// The app mark — same artwork as the bundle icon in src-tauri/icons, so the
// in-app logo always matches what's in the Dock.
export function AppLogo({ size = 32 }: { size?: number }) {
  return <img src={icon} width={size} height={size} alt="trace" draggable={false} />;
}
