# Sona production icons

The November 14 watercolor disc is the system icon. `ui/branding/sona-master.png` is its transparent master. Run `python scripts/export-branding.py ui/branding/sona-master.png` to regenerate all PNG/ICO aliases, with full optical diameter and nine Windows sizes.

`ui/sona-home.png` is the separate transparent blue dome used only on Home. The homepage does not use the dark circular app icon. Both assets were extracted from the supplied references with the built-in image tool.

The release verifies every packaged icon alias and embedded executable icon, then checks installation, upgrade and restarts before publication.
