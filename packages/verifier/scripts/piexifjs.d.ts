// Minimal types for piexifjs (dev-only: used to write EXIF into synthetic fixtures).
declare module "piexifjs" {
  type Rational = [number, number];
  interface ExifDict {
    "0th"?: Record<number, unknown>;
    Exif?: Record<number, unknown>;
    GPS?: Record<number, unknown>;
    "1st"?: Record<number, unknown>;
    thumbnail?: string | null;
  }
  const piexif: {
    dump(exif: ExifDict): string;
    insert(exifBytes: string, jpegBinary: string): string;
    remove(jpegBinary: string): string;
    load(jpegBinary: string): ExifDict;
    ImageIFD: Record<string, number>;
    ExifIFD: Record<string, number>;
    GPSIFD: Record<string, number>;
    GPSHelper: { degToDmsRational(deg: number): [Rational, Rational, Rational] };
  };
  export default piexif;
}
