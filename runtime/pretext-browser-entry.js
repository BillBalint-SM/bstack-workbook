// The design-html skill inlines its vendor asset as a classic script. Keep this
// small adapter separate from the official package so Bun retains every public
// export and exposes the documented browser contract without a module loader.
import * as Pretext from '@chenglou/pretext';

globalThis.Pretext = Pretext;
