package cli

import (
	"context"
	"fmt"

	"github.com/spf13/cobra"
)

func newSummaryCmd(reports reportServiceProvider, prefs preferencesServiceProvider) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "summary",
		Short: "Show monthly expense summary",
		RunE: func(cmd *cobra.Command, args []string) error {
			jsonOutput, _ := cmd.Flags().GetBool("json")
			month, _ := cmd.Flags().GetString("month")

			reportService, preferences, err := reportCommandDependencies(reports, prefs)
			if err != nil {
				return err
			}

			result, err := reportService.Summary(context.Background(), month)
			if err != nil {
				return err
			}

			if jsonOutput {
				return writeJson(result)
			}

			fmt.Printf("Summary for %s\n\n", result.Month)
			for _, c := range result.Categories {
				fmt.Printf("  %-20s  %s\n", c.Name, formatAmount(c.Total, preferences.Currency))
			}
			fmt.Printf("  ────────────────────────────\n")
			fmt.Printf("  %-20s  %s\n", "Total", formatAmount(result.Total, preferences.Currency))
			return nil
		},
	}
	cmd.Flags().Bool("json", false, "output as JSON")
	cmd.Flags().String("month", "", "month (YYYY-MM, defaults to current)")
	return cmd
}
