/* Study configuration. Edit this file, then re-run build_site_v2.py.
 *
 * Collection is OFF by default. While it is off the page records nothing, sends nothing,
 * and participants can only download their own results.
 */
window.SSAP_CONFIG = {
  study: 'SSAP-y Bird',

  collect: {
    enabled: true,          // true = show consent + participant ID, record audio, offer to send data

    // --- Google Drive: paste the Web app URL of the deployed Apps Script (see apps_script/README.md)
    endpoint: 'https://script.google.com/macros/s/AKfycbyTqTa3HjV-udU1r5XiUvvjiY3kFMOz1cDs4qJegiC5wNjJEOSyPL2QEeiX94tGuvyTPg/exec',            // e.g. 'https://script.google.com/macros/s/AKfy.../exec'
    token: 'ASBSkATbSZKnzDwqW8JxVjO0Yv92hzBoNYbHIEjASM4',               // the same shared secret you put in the script (blocks casual spam)

    // --- Box: a "File Request" link. Participants download a ZIP and upload it there.
    boxUploadUrl: '',        // e.g. 'https://buffalo.box.com/f/abcdef...'

    saveAudio: true,         // include raw response recordings (WAV, 22050 Hz mono, as in SSAP)
  },

  // Public leaderboards (top 10 per section). Uses the same endpoint/token as above.
  // Only people who choose "Just play" can post; research participants are never listed.
  leaderboard: { enabled: true },

  consentFile: 'consent.html',     // the page the participant opens from the consent checkbox
  consentVersion: 'SSAP-Consent-IRB20261103-2026-11-26',   // written into every data file; confirm this label, change it whenever the text changes
  requireParticipantId: true,

  // Participant IDs look like SSAP-y_Bird_P001, numbered in the order people take part.
  // With an endpoint set they are assigned automatically; otherwise the number is typed in.
  // Adding ?p=12 to the page address uses P012 instead (handy if you hand out numbers yourself).
  participantPrefix: 'SSAP-y_Bird_P',
  idDigits: 3,
};
