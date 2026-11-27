import type { IncomingBotCall } from "@rakazo/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { followStream } from "../../lib/query/follow-stream";
import { rpc } from "../../lib/query/rpc";
import { spaceChanged } from "../../lib/query/space-changes";

const NO_CALLS: IncomingBotCall[] = [];

/** The account's ringing calls in this Space, as the server's call stream reports them. */
export function useIncomingCalls(spaceId: string | undefined): IncomingBotCall[] {
  const queryClient = useQueryClient();
  const [calls, setCalls] = useState<IncomingBotCall[]>(NO_CALLS);
  useEffect(() => {
    if (!spaceId) return;
    const stop = followStream(
      (signal) => rpc.notifications.subscribeCalls(undefined, { signal }),
      (frame) => {
        if (frame.type === "preferences") void spaceChanged("preferences", queryClient);
        else if (frame.payload)
          setCalls(frame.payload.calls.filter((call) => call.spaceId === spaceId));
      },
      // Calls were turned off: nothing it last reported may keep ringing.
      () => setCalls(NO_CALLS),
    );
    return () => {
      stop();
      setCalls(NO_CALLS);
    };
  }, [queryClient, spaceId]);
  return calls;
}
