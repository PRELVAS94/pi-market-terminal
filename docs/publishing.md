# Publishing and the official Pi gallery

Pi discovers npm packages with the `pi-package` keyword. This package declares `pi.extensions` and a public `pi.image` URL. See [the official package guide](https://pi.dev/docs/latest/packages).

This extension is maintained in its own repository; no Pi core change is required. The gallery is a community catalog, not an endorsement or an upstream merge.

## Release checklist

1. Review the source, screenshot and npm file list. Keep credentials, sessions and machine-specific files out of the repository and tarball.
2. Run `npm ci --ignore-scripts`, `npm run check`, `npm test`, and the optional native Kitty test on the supported setup.
3. Run `npm pack --dry-run --ignore-scripts`. The tarball should contain TypeScript runtime modules, README, license, docs and the screenshot; it should not bundle host-provided Pi modules.
4. Verify that the package name/version is available and the repository/screenshot URLs resolve.
5. Authenticate with npm using `npm login`. Complete account/2FA prompts yourself; do not paste an npm token into an issue or chat.
6. Publish with `npm publish --access public`. The prepublish check runs typechecking and deterministic tests.
7. Verify `npm view pi-market-terminal@0.8.1 name version dist.tarball keywords pi --json` and install the published version into a clean Pi environment.
8. Verify the package appears on [pi.dev/packages](https://pi.dev/packages?name=pi-market-terminal) after catalog indexing. npm publication and gallery indexing are distinct; do not report a gallery listing before it is visible.

The GitHub release can distribute the same npm tarball while npm authentication is pending. Users can install the tagged Git source immediately:

```sh
pi install git:github.com/PRELVAS94/pi-market-terminal@v0.8.1
```

If this Mac still has the original local `market-data` copy loaded, disable or move that copy before installing the public package to avoid registering the same commands twice. Keep its backup outside `~/.pi/agent/extensions` so Pi does not discover it as another extension.
