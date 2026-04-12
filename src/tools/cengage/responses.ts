import type {
  DiscoverCengageLinksResponse,
  GetCengageAssignmentsResponse,
  ListCengageCoursesResponse,
} from '../cengage-contracts';
import {
  DiscoverCengageLinksResponseSchema,
  GetCengageAssignmentsResponseSchema,
  ListCengageCoursesResponseSchema,
} from '../cengage-contracts';

export function asAssignmentsToolResponse(
  payload: GetCengageAssignmentsResponse
) {
  const validated = GetCengageAssignmentsResponseSchema.parse(payload);
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(validated) }],
  };
}

export function asDiscoverToolResponse(payload: DiscoverCengageLinksResponse) {
  const validated = DiscoverCengageLinksResponseSchema.parse(payload);
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(validated) }],
  };
}

export function asListCoursesToolResponse(payload: ListCengageCoursesResponse) {
  const validated = ListCengageCoursesResponseSchema.parse(payload);
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(validated) }],
  };
}
