import { ImageResponse } from "next/og";
import { drawIcon } from "./pwa-icon/draw";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
	return new ImageResponse(drawIcon(size.width), size);
}
