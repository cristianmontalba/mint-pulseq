/**
 * VIDEOS — educational video catalog.
 *
 * Each entry:
 *   {
 *     id:          unique string
 *     title:       video title
 *     description: 1-2 lines about what it shows
 *     embedUrl:    embed URL (YouTube /embed/, Vimeo /video/, or local .mp4)
 *     sequenceId:  'cartesian' | 'epi' | 'radial' | 'spiral'  → trajectory
 *                  or 'gre' | 'spinecho' | 'epi' | 'radial' | 'spiral'  → educational sequence
 *                  or null for general videos
 *     category:    'basic' | 'advanced' | 'pulseq'
 *     anchor:      optional — pins a short clip to one exact place in the app
 *   }
 *
 * Two ways a video reaches the screen:
 *
 * 1. **Builder panel** — filtered by `sequenceId === <selected trajectory>`;
 *    the first match plays in the right-side panel.
 *
 * 2. **Anchored micro-clips** — an `anchor` pins the video to one spot, where
 *    it appears as a fold-out next to the thing it explains. Keep these SHORT
 *    (60-90 s): the point is a clip at the moment of confusion, not a lecture.
 *
 *    { module: 'learn',       page: '<learn page id>' }
 *        → folds out at the foot of that Learn Pulseq page.
 *          Page ids: why-pulseq, seq-file, blocks, clock, simulate,
 *                    pitfalls, round-trip
 *
 *    { module: 'walkthrough', sequence: '<walkthrough id>', row: <0-8> }
 *        → adds a ▶ button beside the "?" in that row of the matrix.
 *          `sequence` is optional; omit it to match any walkthrough.
 *
 * An anchor that points at nothing is simply never rendered, so a typo costs
 * you a missing video, not a broken page.
 */

const videoData = [
    // Add videos here. Commented examples:
    //
    // {
    //     id: 'intro-cartesian',
    //     title: 'Cartesian Acquisition in Pulseq',
    //     description: 'Basic explanation of line-by-line k-space filling.',
    //     embedUrl: 'https://www.youtube.com/embed/VIDEO_ID',
    //     sequenceId: 'cartesian',
    //     category: 'basic'
    // },
    //
    // A micro-clip anchored to one walkthrough row:
    // {
    //     id: 'why-te-delay',
    //     title: 'Why the delay is not simply TE/2',
    //     description: '80 seconds on peak-to-peak timing.',
    //     embedUrl: 'https://www.youtube.com/embed/VIDEO_ID',
    //     sequenceId: null,
    //     category: 'pulseq',
    //     anchor: { module: 'walkthrough', sequence: 'se-2ddft', row: 2 }
    // },
    //
    // A micro-clip anchored to a Learn Pulseq page:
    // {
    //     id: 'raster-in-90s',
    //     title: 'The raster clock in 90 seconds',
    //     description: 'What an off-grid duration does at the scanner.',
    //     embedUrl: 'https://www.youtube.com/embed/VIDEO_ID',
    //     sequenceId: null,
    //     category: 'basic',
    //     anchor: { module: 'learn', page: 'clock' }
    // }
];

window.videoData = videoData;
