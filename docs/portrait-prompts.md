# Theme Portrait Prompts — Leonardo

Generate idle + talking portraits for each Cascade theme. Hand-pick
the best **idle** in Leonardo, then **lock the seed** and run the
talking prompt to keep character continuity.

## General settings (apply to every theme unless noted)

| Setting | Value |
|---|---|
| Aspect ratio | **1:1** square |
| Resolution | **1024×1024** |
| Alchemy | **On** (better detail in faces/eyes) |
| Prompt Magic | **On** for first pass; off if it drifts off-prompt |
| Number of images | 4 per generation (lets you triage) |
| Seed strategy | Generate idle → pick favorite → **copy seed** → run talking prompt with same seed |

## Universal negative prompt (paste at the end of *every* prompt unless theme says otherwise)

> low quality, blurry, watermark, signature, text, words, letters, jpeg artifacts, deformed, bad anatomy, extra limbs, body, neck, shoulders, full body, multiple subjects, frame, border

Add theme-specific exclusions in each section below.

## Iteration tips
- If a face feels off, regenerate **with the same prompt** before changing words. Leonardo is high-variance.
- Faces should fill ~70% of the frame. If the model keeps zooming out, add `tightly framed face only, head and shoulders cropped` to the prompt.
- For talking variants, **lock the seed** so the character stays the same. If it still drifts, add `same character as previous, identical face, identical features` to the start of the talking prompt.
- The chat renders these at 32–128px. Detail that disappears at small sizes (intricate background, fine lines) is wasted budget — keep faces simple and high-contrast.

## Storage
After picking favorites, drop them in `public/portraits/<theme>/`:
- `public/portraits/<theme>/idle.jpg`
- `public/portraits/<theme>/talking.jpg`

The Phase 22 theme registry will map theme key → portrait paths.

---

# 1. Sunny — Light Theme

**Vibe:** Friendly default. The face that greets users who find Cyberpunk intimidating.
**Default name suggestion:** *Buddy* or *Sunny*
**Model:** Lucid Origin (or Leonardo Diffusion XL fallback)
**Style preset:** Vibrant
**Contrast:** 1.0–1.3

### Idle prompt
> A cheerful round yellow smiley face character, simple cartoon style, two wide friendly black dot eyes, soft warm smile, gentle rosy cheeks, clean cream background with subtle pastel sunburst, soft drop shadow, modern flat illustration, joyful expression, looking directly at viewer, Pixar-meets-emoji aesthetic, warm lighting

### Talking prompt (lock seed)
> Same character as previous, identical yellow smiley face, identical eyes and cheeks, mouth open in a happy speaking expression showing a small soft tongue, eyebrows slightly raised, animated mid-sentence, same cream background, same drop shadow, same lighting

### Negative prompt additions
> creepy, scary, photorealistic, grimacing, fangs, multiple smileys, dark, gritty

---

# 2. Cyberpunk — Reference (you already have Delamain assets)

Including this so the prompt is reproducible if you ever want to iterate.

**Vibe:** Tactical AI dispatcher. Current default.
**Default name:** *Delamain* (current)
**Model:** Phoenix 2.0
**Style preset:** Cinematic Closeup
**Contrast:** 1.3

### Idle prompt
> A futuristic AI dispatcher portrait, sleek humanoid face with subtle synthetic features, cyan circuit lines tracing the cheekbones, dark teal background with fine grid pattern, neon cyan accent lighting on the face, calm focused expression, eyes glowing faintly cyan, near-photoreal cyberpunk illustration, head and shoulders, head tilted slightly toward viewer

### Talking prompt
> Same character as previous, identical synthetic face, identical cyan circuitry, mouth open mid-sentence, focused expression, eyes glowing slightly brighter cyan, head and shoulders, same dark teal background, same grid

### Negative prompt additions
> bright pastels, cute, anime exaggeration, cartoon, smiling, primary colors

---

# 3. Console — Retro Terminal / CON-CORE Theme

**Vibe:** 80s hacker, vt100, MS-DOS BBS energy.
**Default name suggestion:** *Console* or *BBS*
**Model:** Phoenix 2.0 or FLUX (sharp text/digit rendering matters here)
**Style preset:** None
**Contrast:** 1.5–1.8 (push it; you want neon glow on black)

### Idle prompt
> A face composed entirely of bright phosphor green glowing 0s and 1s on pure black background, ASCII art portrait of a humanoid head and shoulders, retro CRT monitor aesthetic, slight scanline texture, characters arranged to form eyes nose and a calm thin mouth, monospace digital glyphs, glowing green typography, neutral expression, subtle screen flicker, vt100 terminal vibe, 1980s mainframe style

### Talking prompt (lock seed)
> Same face composed of bright phosphor green 0s and 1s on pure black background, identical ASCII pattern but with the mouth open mid-word forming an oval of binary digits, eyes unchanged, same scanline texture, same glow, same monospace style

### Negative prompt additions
> color other than green, photorealistic skin, blue, red, anime, soft, blurry, smooth shading, gradient

### Tip
Leonardo sometimes ignores "made of digits" and renders a plain green face. If that happens: add at start `intricate ASCII art portrait built entirely from monospace 0 and 1 digits, NOT smooth skin`.

---

# 4. Cog — Hagurumon-soft Steampunk Theme

**Vibe:** Cartoon noir gear. Friendly but with edge — one large eye, expressive mouth, brown industrial palette.
**Default name suggestion:** *Cog* (or *Foreman*)
**Model:** Anime XL (or Lucid Origin fallback)
**Style preset:** Anime General
**Contrast:** 1.2

### Idle prompt
> A cute cartoon character that is a single round bronze gear with a face, one large expressive central round eye like a vintage cartoon, small downturned but soft mouth, gear teeth visible around the perimeter, weathered brown and copper metallic shading, soft rust patina, cartoon noir aesthetic, slight melancholy but endearing expression, simple warm sepia background with soft vignette, head and shoulders crop showing only the gear face, inspired by Digimon Hagurumon but softer and rounder, illustration style

### Talking prompt (lock seed)
> Same single bronze gear character with one round central eye, identical brown copper patina, identical gear teeth, mouth now open in a small surprised oval as if speaking, eye slightly wider, same sepia background, same vignette, same illustration style

### Negative prompt additions
> humanoid body, arms, legs, multiple gears, photorealistic metal, sharp aggressive teeth, scary, dark horror, two eyes

### Tip
Hagurumon-classic has one eye. If Leonardo gives two eyes, add `single cyclopean eye, ONE eye in the center` to the front of the prompt.

---

# 5. Sprite — Pastel / Y2K Aero Theme

**Vibe:** Frosted-glass orb that pulses. Y2K Windows Aero, bubble-tea pastels.
**Default name suggestion:** *Sprite*
**Model:** Phoenix 2.0
**Style preset:** Graphic Design 3D
**Contrast:** 1.0

### Idle prompt
> A glassy iridescent floating orb character, semi-transparent translucent glass sphere with soft pastel rainbow refraction, lavender mint and peach gradients dancing inside, gentle glowing core, two minimal soft white eye highlights suggesting a face without overt features, clean white background with subtle frosted-glass mist, Y2K Windows Aero aesthetic, polished 3D render, soft ambient glow, calm serene expression

### Talking prompt (lock seed)
> Same iridescent translucent glass orb, identical lavender mint peach refraction, internal glow now slightly pulsing brighter, soft ripple effect across the surface as if mid-sound, same minimal white eye highlights, same white background and mist, same 3D render style

### Negative prompt additions
> opaque, solid, dark, gritty, sharp edges, faces, features, mouth, anthropomorphic

### Tip
This one's the easiest to iterate on — most variations will look fine. Pick the one whose internal gradient feels most alive.

---

# 6. Margin — Notebook / Sketchpad Theme

**Vibe:** Hand-drawn doodle face. Cream paper, navy ink, friendly.
**Default name suggestion:** *Margin* (or *Sketch*)
**Model:** DreamShaper or Phoenix 2.0
**Style preset:** Illustration
**Contrast:** 0.9 (keep it gentle — sketches read best at lower contrast)

### Idle prompt
> A hand-drawn doodle face on cream notebook paper, simple navy ink line drawing, two friendly round circle eyes with small dot pupils, gentle curving smile, slightly crooked but charming linework, visible paper texture with faint ruled lines in the background, occasional ink smudge, sketchbook portrait style, top of head visible, calm warm expression, illustrated by a thoughtful designer in a journal, hand-drawn aesthetic

### Talking prompt (lock seed)
> Same hand-drawn doodle face on cream notebook paper, identical navy ink line work, identical round circle eyes, mouth now slightly open in an "o" shape as if speaking, same ruled paper texture, same ink smudge, same sketchbook style

### Negative prompt additions
> photorealistic, digital art polish, color other than navy ink and cream, complex shading, gradient, 3D

### Tip
The "doodle" prompt sometimes leans too kid-drawing. If results feel scrawled-by-a-five-year-old, add `confident clean lines, designer's sketchbook, professional but loose`.

---

# 7. Curator — Library / Academic Theme

**Vibe:** Leather-bound, scholarly, quiet. Cream + burgundy + gold.
**Default name suggestion:** *Curator* (or *Archivist*)
**Model:** Phoenix 2.0
**Style preset:** Concept Art
**Contrast:** 1.2

### Idle prompt
> A scholarly emblem portrait in the style of an old library bookplate, a serif capital letter "C" engraved into a deep burgundy wax seal medallion, soft gold filigree border, surrounded by a faint laurel wreath, cream parchment background with subtle paper grain, gentle warm lamp lighting from upper left, classical illustrative style, calm dignified composition, evokes a private archive

### Talking prompt (lock seed)
> Same wax seal medallion with the "C" emblem, identical burgundy wax and gold filigree, identical cream parchment, but a faint glowing aura now traces the seal edge as if vibrating with sound, otherwise unchanged

### Negative prompt additions
> photorealistic face, human portrait, modern, sleek, neon, cartoon, primary colors

### Tip
This is the only theme where the "portrait" is an emblem rather than a face. Talking-variant variation is subtle (a glow, a slight tilt). That's intentional — the Curator's "talking" cue is mood, not animation.

If you'd rather have an actual face: prompt `portrait of a calm scholarly figure in a cream cardigan, holding a leather-bound book, soft library lighting, illustrated bookplate style, head and shoulders, gold and burgundy palette` with the same model/preset.

---

# 8. Sage — Forest / Sage Theme

**Vibe:** Calm, organic, grounded. Forest green + terracotta.
**Default name suggestion:** *Sage*
**Model:** Anime XL or DreamShaper
**Style preset:** Illustration
**Contrast:** 1.1

### Idle prompt
> A stylized illustrated portrait of a wise gentle owl character, head and shoulders only, large kind round amber eyes, soft russet and forest green plumage, small tufted ears, calm thoughtful expression, warm cream and sage green background with a hint of distant pine silhouette, soft natural daylight, illustrated children's book aesthetic, gentle painterly brushwork

### Talking prompt (lock seed)
> Same illustrated owl character with identical amber eyes and russet feathers, beak now slightly open as if speaking softly, head tilted faintly forward, same cream and sage background, same painterly style

### Negative prompt additions
> photorealistic feathers, predatory, sharp claws, action pose, neon, urban, dark horror

### Tip
If you'd rather have a fox: swap "owl character" → `red fox character with a fluffy white-tipped tail, perked ears`. Same prompt structure, same warmth.

---

# 9. Pilot — Clean Sci-Fi Theme

**Vibe:** Sci-fi without the cyberpunk grit. White + electric blue. Apple-clean SpaceX vibe.
**Default name suggestion:** *Pilot* (or *Captain*)
**Model:** Leonardo Vision XL or FLUX
**Style preset:** Cinematic Closeup
**Contrast:** 1.3

### Idle prompt
> A clean futuristic astronaut helmet portrait, smooth white spacesuit helmet with rounded hexagonal visor, faint electric blue glow tracing the visor edge, the visor reflects a calm starfield with gentle warm sunlight catching the curve, the figure inside is silhouetted, no face visible — just the helmet form, head and shoulders only, soft pure white background with subtle gradient, clean modern industrial design aesthetic, high-end sci-fi product render, polished

### Talking prompt (lock seed)
> Same white astronaut helmet with identical hexagonal visor and electric blue glow, identical reflection, but the blue glow now pulses slightly brighter as if a comm channel is active, faint ripple in the visor reflection, otherwise unchanged

### Negative prompt additions
> dirty, weathered, grimy, cracked helmet, military, aggressive, dark colors, neon overload

### Tip
This one wants a *clean* render. If results come back grimy or war-torn (which Leonardo loves to do for sci-fi), add `pristine showroom condition, brand new, polished` to the front.

---

# 10. Pixel — Saturday Morning Cartoon Theme

**Vibe:** 90s-cartoon mascot. Big eyes, bright primary colors, low-stakes playful.
**Default name suggestion:** *Pixel* (or *Gizmo*)
**Model:** Anime XL
**Style preset:** Anime General
**Contrast:** 1.2

### Idle prompt
> A cute 90s cartoon mascot character, bright cyan blue spherical creature with two giant sparkling round white eyes and tiny black pupils, big happy grin showing two upper teeth, small antenna with a yellow star bobbing on top, head and shoulders only, vivid primary-color background with sunburst rays, Saturday morning cartoon aesthetic, energetic but friendly expression, in the style of Pokemon and Bonkers and old Nickelodeon mascots

### Talking prompt (lock seed)
> Same cyan cartoon mascot with identical sparkly eyes and yellow antenna star, mouth now wide open mid-shout in a cheerful exaggerated speaking expression, antenna tilted slightly forward as if mid-bounce, same vivid sunburst background, same animation style

### Negative prompt additions
> creepy uncanny valley, photorealistic, dark, mature, anime adult, sexy, fanged, scary

### Tip
If you want a different palette: `cyan blue` → any of `magenta pink`, `lime green`, `electric orange`. Keep "spherical" for the body shape — it reads cleaner than humanoid at small sizes.

---

# 11. Quiet — Minimalist Theme

**Vibe:** Apple minimalism, Notion neutrality. No personality, no noise.
**Default name suggestion:** *(none — just the user's name)*
**Model:** N/A — **CSS-rendered**, no AI image needed.

This theme uses a single pulsing dot rendered in CSS rather than an image. Faster, sharper at every zoom level, lower payload. The "talking" state is just a faster pulse rate.

If you'd rather have an asset:

**Model:** Phoenix 2.0
**Style preset:** Graphic Design Vector
**Contrast:** 0.8

### Idle prompt
> A single pure black perfect circle on a clean white background, geometric minimalism, soft subtle drop shadow, centered, vector-clean edges, Apple-design aesthetic, no other elements, pure typography minimalism

### Talking prompt
> Same black circle with identical position, but a soft expanding ripple ring radiating outward as if pulsing with sound, single subtle ring, same white background

### Negative prompt additions
> face, features, color other than black and white, texture, gradient, complex, decoration

---

# 12. Specter — Halloween / Goth Theme

**Vibe:** Dark and fun. Different from cyberpunk's tactical-dark; this is playful-spooky.
**Default name suggestion:** *Specter* (or *Wraith*)
**Model:** Anime XL or DreamShaper
**Style preset:** Illustration
**Contrast:** 1.4

### Idle prompt
> A cute stylized cartoon ghost character, semi-transparent deep purple flowing form, two large hollow black eye sockets with faint glowing violet pupils, small mischievous smile, wispy ethereal trailing edges, head and shoulders only, dark midnight purple background with faint distant graveyard mist silhouette, two tiny floating orange jack-o-lantern ember motes nearby, illustrated horror-cute aesthetic, in the style of Tim Burton meets Studio Ghibli

### Talking prompt (lock seed)
> Same purple ghost character with identical hollow eyes and trailing wispy form, mouth now open in a small surprised "o" as if delivering a secret, identical violet glow in the eye sockets slightly brighter, same midnight background and ember motes

### Negative prompt additions
> photorealistic, gory, blood, jump scare, white sheet ghost cliché, frightening for children, scary horror

### Tip
"Horror-cute" is the dial to land. If results lean gory or actually scary, add `family-friendly spooky cute, NOT horror`.

---

# Workflow summary

For each theme:

1. Open Leonardo, paste **Idle prompt** + **Universal negative + theme-specific negative additions**.
2. Set the model and preset listed.
3. Set 1024×1024, Alchemy on.
4. Generate 4 images. Pick your favorite.
5. **Copy the seed** from the chosen image (gear icon → seed).
6. Paste **Talking prompt** + same negative. Set the same seed.
7. Generate. Pick the best continuity match.
8. Save as `public/portraits/<theme>/idle.jpg` and `public/portraits/<theme>/talking.jpg`.

When you've got all 11 sets (or however many you want to start with), I'll wire the theme registry in Phase 22 — preset selector in Settings → palette + name + portraits applied as a bundle.
