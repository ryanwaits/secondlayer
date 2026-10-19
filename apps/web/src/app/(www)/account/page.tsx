import { AccountOverview } from "@/components/account/overview/account-overview";
import {
	FirstRowsCode,
	FirstRowsPrompt,
} from "@/components/account/overview/first-rows-code";

export default function AccountOverviewPage() {
	return (
		<AccountOverview
			firstRowsCode={<FirstRowsCode />}
			firstRowsPrompt={<FirstRowsPrompt />}
		/>
	);
}
