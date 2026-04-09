package main

import (
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

func MorningBriefWorkflow(ctx workflow.Context) (string, error) {
	workflow.GetLogger(ctx).Info("Starting morning brief workflow")

	retryPolicy := &temporal.RetryPolicy{
		MaximumAttempts:    5,
		InitialInterval:    5 * time.Second,
		BackoffCoefficient: 2,
	}

	opts := workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy:         retryPolicy,
	}
	ctx = workflow.WithActivityOptions(ctx, opts)

	// Fetch all data in parallel.
	var a *Activities

	calendarFuture := workflow.ExecuteActivity(ctx, a.FetchCalendar)
	emailsFuture := workflow.ExecuteActivity(ctx, a.FetchEmails)
	uspsFuture := workflow.ExecuteActivity(ctx, a.FetchUSPSMailScans)

	var calendar, emails, uspsScans string
	if err := calendarFuture.Get(ctx, &calendar); err != nil {
		return "", err
	}
	if err := emailsFuture.Get(ctx, &emails); err != nil {
		return "", err
	}
	if err := uspsFuture.Get(ctx, &uspsScans); err != nil {
		return "", err
	}

	workflow.GetLogger(ctx).Info("All data fetched, generating brief")

	briefOpts := workflow.ActivityOptions{
		StartToCloseTimeout: 60 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts:    5,
			InitialInterval:    10 * time.Second,
			BackoffCoefficient: 2,
		},
	}
	briefCtx := workflow.WithActivityOptions(ctx, briefOpts)

	var brief string
	err := workflow.ExecuteActivity(briefCtx, a.GenerateBrief, BriefInput{
		Calendar:  calendar,
		Emails:    emails,
		USPSScans: uspsScans,
	}).Get(ctx, &brief)
	if err != nil {
		return "", err
	}

	workflow.GetLogger(ctx).Info("Morning brief complete")
	return brief, nil
}
