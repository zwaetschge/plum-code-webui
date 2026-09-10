# Plum theme and design tokens

Everything a screen needs to look like the rest of the app lives in this
package. The rule for new and migrated code:

**Screens use tokens, not literals.** No `16.dp`, `RoundedCornerShape(12.dp)`,
`tween(200)` or `Color.White.copy(alpha = .05f)` in `ui/screens/**` or
`ui/components/**`; read the value from `PlumTheme.tokens` instead.

## Files

| File                                                         | Holds                                                                                                                                                     |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PlumPalette.kt`                                             | The colours. `PlumDarkPalette`, `PlumLightPalette`, `PlumEinkPalette`, `LocalPlumPalette`, and `toMaterialScheme()` for the Material-built screens.       |
| `PlumTokens.kt`                                              | Spacing, radius/shapes, elevation, surface roles, borders, motion, sizing. `LocalPlumTokens`, `PlumTheme.tokens`, `plumTokensFor(palette, reduceMotion)`. |
| `PlumGlass.kt`                                               | `GlassRole`, `Modifier.plumGlass(...)`, `PlumGlassCard(...)`, `LocalPlumHazeReady`.                                                                       |
| `Theme.kt`                                                   | `ClaudeWebUITheme { }`: builds the Material scheme from the palette and provides `LocalPlumTokens`, `LocalExtendedColors`, `LocalReduceMotion`.           |
| `ProviderThemes.kt`                                          | Per-provider accent/container colours; resolved for the active brightness through `PlumTheme.tokens.providerAccent(provider)`.                            |
| `AppThemeStore.kt`, `LayoutPrefs.kt`, `MotionPreferences.kt` | Persisted user preferences (theme option, two-pane, reduced motion).                                                                                      |
| `Color.kt`, `Type.kt`                                        | Legacy brand constants and the typography scale.                                                                                                          |

`MainActivity` picks the palette with `paletteFor(AppThemeStore.theme, isSystemInDarkTheme())`
and provides `LocalPlumPalette`; `ClaudeWebUITheme` then derives the tokens
from that palette, so a new palette gets matching surfaces for free.

## Accessing tokens

```kotlin
val t = PlumTheme.tokens          // or ClaudeWebUITheme.tokens
Modifier.padding(horizontal = t.spacing.screenHorizontal)
Column(verticalArrangement = Arrangement.spacedBy(t.spacing.listGap))
Box(Modifier.clip(t.radius.cardShape))
Icon(..., modifier = Modifier.size(t.sizing.iconInline))
animateFloatAsState(target, animationSpec = t.motion.tweenMedium())
val accent = t.providerAccent(CliProvider.CODEX)
```

## Token values

Values were chosen from a survey of `app/src/main/**/*.kt` (counts are
occurrences of the literal), so every token already matches heavy use.

### Spacing (`tokens.spacing`)

| Token     | dp  | Survey            |
| --------- | --- | ----------------- |
| `xxs`     | 2   | 71                |
| `xs`      | 4   | 144               |
| `inline`  | 6   | 110               |
| `sm`      | 8   | 275 (most common) |
| `compact` | 10  | 125               |
| `md`      | 12  | 261               |
| `cozy`    | 14  | 114               |
| `lg`      | 16  | 237               |
| `section` | 20  | 68                |
| `xl`      | 24  | 38                |
| `xxl`     | 32  | 25                |

Semantic aliases: `screenHorizontal` 16 (55 uses of `padding(horizontal = 16.dp)`),
`listGap` 12, `cardPadding` 16 (18 `GlassPanel` bodies use `padding(16.dp)`),
`rowGap` 8 (95 uses of `spacedBy(8.dp)`), `headerHorizontal` 18, `headerVertical` 14.

### Radius (`tokens.radius`)

| Token   | dp  | Survey (`RoundedCornerShape(...)`) |
| ------- | --- | ---------------------------------- |
| `xxs`   | 2   | 7                                  |
| `xs`    | 4   | 7                                  |
| `sm`    | 8   | 24                                 |
| `chip`  | 10  | 25                                 |
| `md`    | 12  | 66 (most common)                   |
| `lg`    | 16  | 24                                 |
| `panel` | 20  | 9 + `GlassPanel` default           |
| `xl`    | 24  | 8                                  |
| `bar`   | 30  | floating nav bar                   |
| `xxl`   | 32  | Material extraLarge                |

Shapes: `cardShape` (16), `rowShape` (12), `panelShape` (20), `sheetShape`
(24 top corners), `chipShape` (10), `pill` (`RoundedCornerShape(50)`, 21 uses),
`circle`, `bubbleShape` (16), `bubbleIncomingShape` (4/16/16/16 as in
`ChatScreen`), `bubbleOutgoingShape`, `barShape` (30).

### Elevation (`tokens.elevation`)

`level0` 0 (7 uses), `level1` 1 (3), `level2` 2 (1), `level3` 8 (file manager),
`level4` 10 (`GlassPanel` shadow). The app is flat by design; prefer `level0`.

### Surfaces (`tokens.surfaces`)

Each role is a `PlumSurfaceRole` with `container`, `containerTop`, `border`,
`highlight`, `blurRadius`, `opaqueFallback`, `foreground`, `foregroundMuted`,
`shadow`, `elevation`. `opaqueFallback` is the container composited over the
palette background, and both foreground colours are checked for WCAG AA
(4.5:1) against it in `plumTokensFor`.

| Role          | Dark container              | Light container   | Blur  | Use                                          |
| ------------- | --------------------------- | ----------------- | ----- | -------------------------------------------- |
| `glass`       | white 4.5 % → 8.5 %         | white 62 % → 80 % | none  | Default card, mirrors WebUI `.glass-panel`.  |
| `glassStrong` | `surface` → `surfaceStrong` | same              | none  | Text-heavy panels.                           |
| `raised`      | `controlSurface`            | white             | none  | Round icon buttons, floating chips.          |
| `sunken`      | `segmentTrack`              | `segmentTrack`    | none  | Segmented tracks, progress rails. No border. |
| `overlay`     | background 55 %             | background 55 %   | 28 dp | Floating bars and sheets above content.      |

E-Ink has no translucency: `highlight` is transparent and every `blurRadius`
is 0, so the same call sites render flat white with a hard border.

### Borders (`tokens.border`)

`hairline` 1 dp (69 uses of `1.dp`), `subtle` = palette `borderSoft`,
`strong` = palette `border`, `focus` = palette `accent`.

### Motion (`tokens.motion`)

`fast` 150 ms, `medium` 220 ms, `slow` 360 ms (survey: `tween(150)` 7,
`tween(200)` 7, `tween(220)` 6). Easings: `standardEasing`
(`FastOutSlowInEasing`, 14 uses), `decelerateEasing`, `emphasizedEasing`,
`exitEasing`. When the system animator scale is off (`LocalReduceMotion`),
all durations resolve to `0`, so `tweenFast()/tweenMedium()/tweenSlow()` snap.

### Sizing (`tokens.sizing`)

`touchTarget` 48 (17 uses), `iconXs` 14 (32), `iconSm` 16 (31), `iconInline` 18
(41, the most common icon), `iconMd` 20 (23), `iconLg` 24, `avatarSm` 28,
`avatarMd` 34, `avatarLg` 40, `statusDot` 8, `statusDotLarge` 10, `badge` 15,
`navBarHeight` 78 / `navBarHeightShort` 54, `navRailWidth` 96 / `navRailWidthShort` 68.

## Glass primitives

```kotlin
// Any shape: translucent fill + luminous hairline (+ top highlight).
Modifier.plumGlass(role = GlassRole.Default, shape = PlumTheme.tokens.radius.rowShape)

// Card with shadow, padding and an AA content colour.
PlumGlassCard(role = GlassRole.Strong, onClick = { ... }) { Text("...") }
```

Blur is opt-in per role (`GlassRole.Overlay` only) and only happens when all
of these hold: `LocalPlumHazeReady` is `true` (provided by `PlumNavScaffold`
around the floating bottom bar), the device is API 31+ (RenderEffect), and
the palette has glass. Otherwise the role's `opaqueFallback` is painted.
Do not place a blurring surface inside the `Modifier.haze(...)` source it
samples; that draws itself recursively.

Keep glass sparse: one frosted layer per screen region reads as depth, three
stacked read as fog. Body text goes on `glassStrong` or an opaque surface.

## Migration guide for screens

Apply mechanically, then eyeball the screen once.

| Literal                                            | Token                                                                                  |
| -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `2.dp`                                             | `tokens.spacing.xxs`                                                                   |
| `4.dp`                                             | `tokens.spacing.xs`                                                                    |
| `6.dp`                                             | `tokens.spacing.inline`                                                                |
| `8.dp`                                             | `tokens.spacing.sm` (or `rowGap` in `spacedBy`)                                        |
| `10.dp`                                            | `tokens.spacing.compact`                                                               |
| `12.dp`                                            | `tokens.spacing.md` (or `listGap` between cards)                                       |
| `14.dp`                                            | `tokens.spacing.cozy`                                                                  |
| `16.dp`                                            | `tokens.spacing.lg` (`screenHorizontal` for screen insets, `cardPadding` inside cards) |
| `20.dp`                                            | `tokens.spacing.section`                                                               |
| `24.dp` / `32.dp`                                  | `tokens.spacing.xl` / `xxl`                                                            |
| `RoundedCornerShape(8.dp)`                         | `RoundedCornerShape(tokens.radius.sm)`                                                 |
| `RoundedCornerShape(10.dp)`                        | `tokens.radius.chipShape`                                                              |
| `RoundedCornerShape(12.dp)`                        | `tokens.radius.rowShape`                                                               |
| `RoundedCornerShape(16.dp)`                        | `tokens.radius.cardShape`                                                              |
| `RoundedCornerShape(20.dp)`                        | `tokens.radius.panelShape`                                                             |
| `RoundedCornerShape(50)`                           | `tokens.radius.pill`                                                                   |
| `CircleShape`                                      | `tokens.radius.circle` (optional)                                                      |
| `size(48.dp)` on a control                         | `tokens.sizing.touchTarget`                                                            |
| `size(14/16/18/20/24.dp)` on an `Icon`             | `iconXs/iconSm/iconInline/iconMd/iconLg`                                               |
| `size(8.dp)` status dot                            | `tokens.sizing.statusDot`                                                              |
| `1.dp` border                                      | `tokens.border.hairline`                                                               |
| `PlumBorderSoft` / `PlumBorder` as a border colour | `tokens.border.subtle` / `strong`                                                      |
| `tween(150..200)`                                  | `tokens.motion.tweenFast()`                                                            |
| `tween(220)`                                       | `tokens.motion.tweenMedium()`                                                          |
| `tween(300..500)`                                  | `tokens.motion.tweenSlow()`                                                            |
| `cardElevation(defaultElevation = 0.dp)`           | `tokens.elevation.level0`                                                              |
| `glassSurface(shape)`                              | `plumGlass(shape = shape)` (same look)                                                 |
| `GlassPanel { }` with `padding(16.dp)`             | `PlumGlassCard { }`                                                                    |
| `Color.White.copy(alpha = ...)` fill               | a `tokens.surfaces.<role>.container`                                                   |

Values with no token (`7.dp`, `9.dp`, `13.dp`, `15.dp`, `22.dp`, `26.dp`) are
candidates to round to the nearest step when the screen is touched; leave
them if the change is visible in a dense layout.
