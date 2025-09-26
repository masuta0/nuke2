{ pkgs }: {
  deps = [
    pkgs.nodejs
    pkgs.pkg-config
    pkgs.cairo
    pkgs.pango
    pkgs.libpng
    pkgs.jpeg
    pkgs.giflib
    pkgs.python3
    pkgs.gcc
  ];
}
