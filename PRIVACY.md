# Privacy / 数据处理说明

HTML Canvas does not upload source HTML, ZIP archives, images or font files to a developer-operated server. Files are read and processed in plugin memory. The release manifest requests no network access. The plugin does not include analytics, advertising, a sign-in flow or remote image proxying.

Imported content is written to the Figma document selected by the user. Figma may store, sync and share that document according to its own account, sharing and privacy settings. “Local processing” does not mean the resulting Figma document is stored only on the device.

Inline scripts may run in an isolated iframe to capture the rendered page and interactive states. The iframe's content security policy restricts network APIs, remote subresources and form submissions. It does not fully prevent the iframe from navigating itself. Only import HTML from sources you trust. Scripts are removed from snapshots before layer conversion. Local styles and assets are embedded from the selected archive. Missing and blocked resources are reported where detected.

The plugin retains no account credentials and writes no source archives to client storage. Temporary parsing frames and staging pages are cleaned up on completion/failure; font-matching caches exist only for the running session. Closing the plugin discards its in-memory state.

Support / 支持：l1781874099@gmail.com。本说明适用于当前源码中的轻量本地导入入口。
