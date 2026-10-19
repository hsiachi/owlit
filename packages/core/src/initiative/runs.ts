// The kinds of Owlit's runs on the user's docs, as tasks: rules queue them or the user asks for them;
// reviews.ts runs them

// Owlit's answer to the user's reply under one of its comments
export const REPLY_RUN = "docs.reply"
// Owlit's comments that lean on a paper the user has now read in full, looked at again
export const RECHECK_RUN = "docs.recheck"

// Material from people (a meeting, reviews) gone through against the docs: a record beside it, the points
// as comments carried over from it
export const GO_THROUGH_RUN = "meetings.goThrough"

// Runs that write Owlit's comments through docs_add_comment, by the prefix of the run id they sign with
export const COMMENTING_RUNS = [GO_THROUGH_RUN] as const
