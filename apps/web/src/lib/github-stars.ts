/** Star count for the nav's GitHub pill; absent on API failure. */
export async function readGithubStars(): Promise<number | null> {
	try {
		const res = await fetch(
			"https://api.github.com/repos/ryanwaits/secondlayer",
			{ next: { revalidate: 3600 } },
		);
		if (!res.ok) return null;
		const repo = (await res.json()) as { stargazers_count?: number };
		return typeof repo.stargazers_count === "number"
			? repo.stargazers_count
			: null;
	} catch {
		return null;
	}
}
