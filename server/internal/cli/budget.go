package cli

import (
	"context"
	"fmt"

	"expense-tracker/internal/config"

	"github.com/spf13/cobra"
)

func newBudgetCmd(reports reportServiceProvider, prefs preferencesServiceProvider) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "budget",
		Short: "Show budget status",
		RunE: func(cmd *cobra.Command, args []string) error {
			jsonOutput, _ := cmd.Flags().GetBool("json")
			month, _ := cmd.Flags().GetString("month")

			reportService, preferences, err := reportCommandDependencies(reports, prefs)
			if err != nil {
				return err
			}

			result, err := reportService.Budget(context.Background(), month)
			if err != nil {
				return err
			}

			if jsonOutput {
				return writeJson(result)
			}

			fmt.Printf("Budget for %s\n\n", result.Month)
			for _, c := range result.Categories {
				status := "✓"
				if c.OverBudget {
					status = "⚠ OVER"
				}
				fmt.Printf("  %-20s  %s / %s  %s\n",
					c.Name,
					formatAmount(c.Spent, preferences.Currency),
					formatAmount(c.Budget, preferences.Currency),
					status,
				)
			}
			return nil
		},
	}
	cmd.Flags().Bool("json", false, "output as JSON")
	cmd.Flags().String("month", "", "month (YYYY-MM, defaults to current)")
	return cmd
}

func reportCommandDependencies(reports reportServiceProvider, prefs preferencesServiceProvider) (reportCLIService, config.Preferences, error) {
	reportService := reports()
	if reportService == nil {
		return nil, config.Preferences{}, fmt.Errorf("report service is not initialized")
	}
	prefService := prefs()
	if prefService == nil {
		return nil, config.Preferences{}, fmt.Errorf("cli runtime is not initialized")
	}
	return reportService, prefService.GetPreferences(), nil
}
