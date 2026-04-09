package main

import (
	"context"
	"fmt"

	"go.temporal.io/sdk/activity"
)

type BriefInput struct {
	Calendar  string
	Emails    string
	USPSScans string
}

type Activities struct{}

func (a *Activities) FetchCalendar(ctx context.Context) (string, error) {
	activity.GetLogger(ctx).Info("Fetching calendar events")
	return "[STUB] Calendar events go here.", nil
}

func (a *Activities) FetchEmails(ctx context.Context) (string, error) {
	activity.GetLogger(ctx).Info("Fetching emails")
	// Return a large-ish string to trigger external storage with the low threshold.
	return fmt.Sprintf("[STUB] %2000s", "Email content goes here."), nil
}

func (a *Activities) FetchUSPSMailScans(ctx context.Context) (string, error) {
	activity.GetLogger(ctx).Info("Fetching USPS mail scans")
	return "[STUB] USPS mail scans go here.", nil
}

func (a *Activities) GenerateBrief(ctx context.Context, input BriefInput) (string, error) {
	activity.GetLogger(ctx).Info("Generating brief")
	return fmt.Sprintf(
		"Morning Brief\n\nCalendar: %s\n\nEmails: %s\n\nUSPS: %s",
		input.Calendar, input.Emails, input.USPSScans,
	), nil
}
