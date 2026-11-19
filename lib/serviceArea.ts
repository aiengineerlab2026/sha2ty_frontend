/** A request's delivery area lies in one of the vendor's service areas (words in either, ignoring case). */
export const inServiceArea = (location: string, areas: string[] | undefined) =>
  Boolean(areas?.some((a) => a.trim() && location.toLowerCase().includes(a.trim().toLowerCase())));
