# Sona production icons

The approved November 15 graphite and blue watercolor disc is the system icon. `ui/branding/sona-master.png` is its transparent master. Run `python scripts/export-branding.py ui/branding/sona-master.png` to regenerate all PNG/ICO aliases, with full optical diameter and nine Windows sizes.

`ui/sona-home.png` is the separate transparent blue dome used only on Home. The homepage does not use the dark circular app icon. The graphite region was copied directly from the supplied reference; the existing separate Home asset is unchanged.

The release verifies every packaged icon alias and embedded executable icon, then checks installation, upgrade and restarts before publication.
