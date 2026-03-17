import { notFound } from "next/navigation";
import { apiRequest, getSessionFromCookies, ApiError } from "@/lib/api";
import type { Stream } from "@/lib/types";
import { FiltersClient } from "./filters-client";

export default async function StreamFiltersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSessionFromCookies();
  if (!session) notFound();

  const { id } = await params;

  let stream: Stream;
  try {
    stream = await apiRequest<Stream>(`/api/streams/${id}`, {
      sessionToken: session,
    });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }

  const activeCount = Array.isArray(stream.filters) ? stream.filters.length : 0;

  return (
    <>
      <div className="dash-section-wrap">
        <hr />
        <h2 className="dash-section-title">Current filters</h2>
      </div>
      <FiltersClient stream={stream} />

      <div className="dash-section-wrap">
        <hr />
        <h2 className="dash-section-title">Filter reference</h2>
      </div>
      <div className="dash-props">
        <div className="dash-prop-row">
          <span className="dash-prop-name">stx_transfer</span>
          <span className="dash-prop-type">sender, recipient, minAmount, maxAmount</span>
        </div>
        <div className="dash-prop-row">
          <span className="dash-prop-name">nft_mint</span>
          <span className="dash-prop-type">recipient, assetIdentifier, tokenId</span>
        </div>
        <div className="dash-prop-row">
          <span className="dash-prop-name">nft_transfer</span>
          <span className="dash-prop-type">sender, recipient, assetIdentifier, tokenId</span>
        </div>
        <div className="dash-prop-row">
          <span className="dash-prop-name">ft_transfer</span>
          <span className="dash-prop-type">sender, recipient, assetIdentifier, minAmount</span>
        </div>
        <div className="dash-prop-row">
          <span className="dash-prop-name">contract_call</span>
          <span className="dash-prop-type">contractId, functionName, caller</span>
        </div>
        <div className="dash-prop-row">
          <span className="dash-prop-name">contract_deploy</span>
          <span className="dash-prop-type">deployer, contractName</span>
        </div>
        <div className="dash-prop-row">
          <span className="dash-prop-name">print_event</span>
          <span className="dash-prop-type">contractId, topic, contains</span>
        </div>
      </div>

    </>
  );
}
