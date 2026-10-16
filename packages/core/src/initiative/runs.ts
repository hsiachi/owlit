// The kinds of Owlit's runs on the user's docs, as tasks: rules queue them, reviews.ts runs them

// A doc read because the user opened it, changed since Owlit last looked
export const REVIEW_RUN = "docs.review"
// The same reading, of a doc the user stopped editing a while before going away
export const SETTLED_REVIEW_RUN = "docs.reviewSettled"
// Owlit's answer to the user's reply under one of its comments
export const REPLY_RUN = "docs.reply"
// The daily look over the docs while the user is away: half-done sections, comments left behind
export const SCAN_RUN = "docs.scan"
// Owlit's comments that lean on a paper the user has now read in full, looked at again
export const RECHECK_RUN = "docs.recheck"

// Runs that write Owlit's comments through docs_add_comment, by the prefix of the run id they sign with
export const COMMENTING_RUNS = [REVIEW_RUN, SETTLED_REVIEW_RUN, SCAN_RUN] as const
