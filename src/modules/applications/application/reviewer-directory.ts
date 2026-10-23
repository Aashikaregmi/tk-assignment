// Port: identity owns users and roles; this module only asks.
export abstract class ReviewerDirectory {
  abstract isReviewer(userId: string): Promise<boolean>;
}
