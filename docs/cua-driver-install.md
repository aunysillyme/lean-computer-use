# Install cua-driver carefully

The upstream driver controls native Mac apps through macOS permissions.
Use [trycua/cua's README](https://github.com/trycua/cua) for its current installation command and supported release.
This package does not bundle or install cua-driver.
The vendor release, checksum and command behavior below are UNVERIFIED for your installed version until you check them locally.

## Verify the download

Compare the downloaded artifact with a checksum published by the upstream project when one is available.
Confirm the signature's identity against upstream release information.
For the app bundle, use Apple's signature and notarization checks:

```sh
codesign --verify --deep --strict /Applications/CuaDriver.app
spctl --assess --verbose /Applications/CuaDriver.app
```

Resolve a failed assessment before granting permissions.
These commands verify the local artifact; a successful check alone does not establish that it is the release you intended to download.

## Check telemetry and permissions

Inspect the commands offered by your installed version:

```sh
cua-driver --version
cua-driver telemetry --help
cua-driver telemetry status
cua-driver permissions status --json
```

Disable telemetry with the installed version's supported command (`cua-driver telemetry disable` when listed), then check `cua-driver telemetry status` again.
The exact disable subcommand is UNVERIFIED until confirmed by your local help output.

Grant Accessibility and Screen Recording deliberately:

```sh
cua-driver permissions grant
cua-driver permissions status --json
cua-driver status
```

Confirm that `accessibility` and `screen_recording` are true.
Review macOS System Settings if the permission command opens a settings pane.
Keep credentials and other sensitive content out of app briefs.

## Use and close

`desk` starts the app-backed daemon on demand in the background, retaining its macOS permission identity.
After a run, call `desk-clean <bundle> --app-name <Name>`.
Add `--launched-by-run` only when the initial snapshot showed the app closed and this run launched it.
This requests a gentle quit, removes owned desk state and stops the driver when no live sessions remain.
An app that remains running is a pending cleanup result; keep its unsaved work safe and report it.

Use `npx lean-computer-use doctor` to check the installation and receive one-line fixes.
On other platforms the driver checks are warnings and package checks still run.
