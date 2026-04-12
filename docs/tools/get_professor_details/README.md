# `get_professor_details`

## Features

- Fetches detailed ratings/comments for one RMP professor by `teacherId`.
- Returns metrics (`overallRating`, `difficulty`, `numRatings`, `wouldTakeAgainPercent`) and recent reviews.
- Caches detail payloads.

## Known Problems

- External API/field changes can break parsing.
- Some profiles have sparse/hidden recent review data.

## Tests

- Prompt: "Get professor details for ID <teacherId>."
- Validate output includes `professor.metrics` and `recentReviews`.

## Edge Cases

- Invalid or stale `teacherId`.
- Rate limits or temporary RMP upstream failures.

## Technical Notes

- Source: `src/tools/rmp.ts` (`getProfessorDetailsTool`).
- Uses `RMPClient.getTeacherDetails(teacherId)`.
- Cache key format: `rmp_details_<teacherId>`.
