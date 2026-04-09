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
	driverMode := getenv("DRIVER", "both") // "s3", "local", or "both"
	awsRegion := getenv("AWS_REGION", "us-east-2")
	s3Bucket := getenv("S3_BUCKET", "payload-storage-364655878703-us-east-2-an")
	localDir := getenv("LOCAL_STORE_DIR", "/tmp/temporal-payload-store")

	var drivers []converter.StorageDriver

	// Create the S3 storage driver.
	if driverMode == "s3" || driverMode == "both" {
		cfg, err := config.LoadDefaultConfig(context.Background(),
			config.WithRegion(awsRegion),
		)
		if err != nil {
			log.Fatalf("load AWS config: %v", err)
		}

		s3Driver, err := s3driver.NewDriver(s3driver.Options{
			Client: awssdkv2.NewClient(awss3.NewFromConfig(cfg)),
			Bucket: s3driver.StaticBucket(s3Bucket),
		})
		if err != nil {
			log.Fatalf("create S3 driver: %v", err)
		}
		drivers = append(drivers, s3Driver)
		log.Printf("S3 driver enabled  bucket=%s", s3Bucket)
	}

	// Create the local disk storage driver.
	if driverMode == "local" || driverMode == "both" {
		localDriver := NewLocalDiskStorageDriver(localDir)
		drivers = append(drivers, localDriver)
		log.Printf("Local disk driver enabled  dir=%s", localDir)
	}

	if len(drivers) == 0 {
		log.Fatalf("no drivers configured, set DRIVER to s3, local, or both")
	}

	// Connect to Temporal with external storage configured.
	// When both drivers are registered, the first driver (S3) is used for new
	// payloads. The local driver stays available for retrieval only.
	c, err := client.Dial(client.Options{
		HostPort: getenv("TEMPORAL_ADDRESS", "localhost:7233"),
		ExternalStorage: converter.ExternalStorage{
			Drivers:              drivers,
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
