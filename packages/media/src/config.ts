/** What the media pipeline needs to know about the machine it runs on. */
export interface MediaConfig {
  ffmpeg: string;
  ffprobe: string;
  /** folder holding the optional neural separator (`tools/venv`, installed by `pnpm setup:separation`) */
  toolsDir: string;
}
