/** Bound, owner-facing transport disclosure only; never a Windows permission grant. */
export type RemoteApprovalDisclosure = {
  id:string;
  tool:string;
  risk:"low"|"medium"|"high";
  summary:string;
  target:string;
};
export declare function remoteApprovalDisclosure(
  prepared:unknown,proposal:unknown
):RemoteApprovalDisclosure|null;
