package main

import (
	"context"
	"log"
	"os"

	"github.com/aws/aws-sdk-go-v2/config"
	awss3 "github.com/aws/aws-sdk-go-v2/service/s3"

	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/contrib/aws/s3driver"
	"go.temporal.io/sdk/contrib/aws/s3driver/awssdkv2"
	"go.temporal.io/sdk/converter"
	"go.temporal.io/sdk/worker"
)

const taskQueue = "morning-brief-go"

func main() {
	awsRegion := getenv("AWS_REGION", "us-east-2")
	s3Bucket := getenv("S3_BUCKET", "payload-storage-364655878703-us-east-2-an")

	// Load AWS credentials and region from the environment or ~/.aws config.
	cfg, err := config.LoadDefaultConfig(context.Background(),
		config.WithRegion(awsRegion),
	)
	if err != nil {
		log.Fatalf("load AWS config: %v", err)
	}

	// Create the S3 storage driver.
	driver, err := s3driver.NewDriver(s3driver.Options{
		Client: awssdkv2.NewClient(awss3.NewFromConfig(cfg)),
		Bucket: s3driver.StaticBucket(s3Bucket),
	})
	if err != nil {
		log.Fatalf("create S3 driver: %v", err)
	}

	// Connect to Temporal with external storage configured.
	c, err := client.Dial(client.Options{
		HostPort: getenv("TEMPORAL_ADDRESS", "localhost:7233"),
		ExternalStorage: converter.ExternalStorage{
			Drivers:              []converter.StorageDriver{driver},
			PayloadSizeThreshold: 1_000, // 1KB — low threshold for testing
		},
	})
	if err != nil {
		log.Fatalf("connect to Temporal: %v", err)
	}
	defer c.Close()

	w := worker.New(c, taskQueue, worker.Options{})

	w.RegisterWorkflow(MorningBriefWorkflow)
	w.RegisterActivity(&Activities{})

	log.Printf("Worker started on task queue: %s", taskQueue)
	if err := w.Run(worker.InterruptCh()); err != nil {
		log.Fatalf("worker stopped: %v", err)
	}
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
